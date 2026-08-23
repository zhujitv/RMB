import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";

const jiti = createJiti(import.meta.url);
const {
  PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES,
  purchaseOrderDispatchAttachmentEmailFileName,
  readValidatedPurchaseOrderDispatchAttachment,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-dispatch-attachment-validation.ts")
>("../lib/platform/factory-purchase-order-dispatch-attachment-validation.ts");
const {
  parseDispatchAttachmentSnapshot,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-dispatch-attachment-snapshot.ts")
>("../lib/platform/factory-purchase-order-dispatch-attachment-snapshot.ts");
const {
  resendAttachmentPayload,
} = await jiti.import<
  typeof import("../lib/platform/notification-email-transport.ts")
>("../lib/platform/notification-email-transport.ts");

const PDF_MIME = "application/pdf";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const read = (path: string) => readFileSync(path, "utf8");

const validationSource = read("lib/platform/factory-purchase-order-dispatch-attachment-validation.ts");
const attachmentSource = read("lib/platform/factory-purchase-order-dispatch-attachment.ts");
const snapshotSource = read("lib/platform/factory-purchase-order-dispatch-attachment-snapshot.ts");
const routeSource = read("app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/dispatch-attachment/route.ts");
const outboxSource = read("lib/platform/factory-purchase-order-dispatch-outbox.ts");
const processorSource = read("lib/platform/factory-purchase-order-dispatch-notifications.ts");
const dispatchSource = read("lib/platform/sales-execution-dispatch.ts");
const fileAssetSource = read("lib/platform/file-asset-data.ts");
const attachmentUiSource = read("app/modules/sales-execution/purchase-order-dispatch-attachment.tsx");
const purchaseOrderListSource = read("app/modules/sales-execution/purchase-order-draft-list.tsx");
const notificationDefinitionSource = read("lib/platform/notification-factory-purchase-order-definition.ts");

function coded(code: string) {
  return (error: unknown) => (error as { code?: string }).code === code;
}

function file(body: Buffer | string, name: string, type: string) {
  if (typeof body === "string") return new File([body], name, { type });
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return new File([bytes], name, { type });
}

async function xlsx(entries: Record<string, Buffer | string> = {}) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      `<Override PartName="/xl/workbook.xml" ContentType="${XLSX_MIME}.main+xml"/>`,
      "</Types>",
    ].join(""),
  );
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
  );
  for (const [name, body] of Object.entries(entries)) zip.file(name, body);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

function utf16Xml(value: string, byteOrder: "le" | "be") {
  const content = Buffer.from(value, "utf16le");
  if (byteOrder === "be") content.swap16();
  return Buffer.concat([Buffer.from(byteOrder === "le" ? [0xff, 0xfe] : [0xfe, 0xff]), content]);
}

function utf32Xml(value: string, byteOrder: "le" | "be") {
  const content = Buffer.alloc(value.length * 4);
  for (let index = 0; index < value.length; index += 1) {
    if (byteOrder === "le") content.writeUInt32LE(value.charCodeAt(index), index * 4);
    else content.writeUInt32BE(value.charCodeAt(index), index * 4);
  }
  return Buffer.concat([
    Buffer.from(byteOrder === "le" ? [0xff, 0xfe, 0x00, 0x00] : [0x00, 0x00, 0xfe, 0xff]),
    content,
  ]);
}

test("purchase-order dispatch attachment validator accepts genuine PDF and safe XLSX files", async () => {
  const document = await PDFDocument.create();
  document.addPage([595, 842]);
  const pdfBody = Buffer.from(await document.save());
  const pdf = await readValidatedPurchaseOrderDispatchAttachment(
    file(pdfBody, "supplier-detail.pdf", PDF_MIME),
  );
  assert.equal(pdf.extension, "pdf");
  assert.equal(pdf.mimeType, PDF_MIME);
  assert.deepEqual(pdf.body, pdfBody);

  const xlsxBody = await xlsx();
  const workbook = await readValidatedPurchaseOrderDispatchAttachment(
    file(xlsxBody, "supplier-detail.xlsx", XLSX_MIME),
  );
  assert.equal(workbook.extension, "xlsx");
  assert.equal(workbook.mimeType, XLSX_MIME);
  assert.deepEqual(workbook.body, xlsxBody);
});

test("validator rejects invalid extensions, signatures, and files larger than 10MB", async () => {
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file("plain text", "detail.txt", "text/plain")),
    coded("PURCHASE_ORDER_ATTACHMENT_TYPE_NOT_ALLOWED"),
  );
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file("not a pdf", "detail.pdf", PDF_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_SIGNATURE_INVALID"),
  );
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file("not a zip", "detail.xlsx", XLSX_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_SIGNATURE_INVALID"),
  );
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(
      Buffer.alloc(PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES + 1, 0x61),
      "too-large.pdf",
      PDF_MIME,
    )),
    coded("PURCHASE_ORDER_ATTACHMENT_TOO_LARGE"),
  );
});

test("PDF validator rejects active content and appended payloads", async () => {
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(
      "%PDF-1.7\n1 0 obj\n<</OpenAction 2 0 R>>\nendobj\n%%EOF",
      "active.pdf",
      PDF_MIME,
    )),
    coded("PURCHASE_ORDER_ATTACHMENT_PDF_ACTIVE_CONTENT"),
  );
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(
      "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\nappended executable payload",
      "appended.pdf",
      PDF_MIME,
    )),
    coded("PURCHASE_ORDER_ATTACHMENT_PDF_UNSAFE"),
  );
});

test("XLSX validator rejects external relationships, macros, and embedded objects", async () => {
  const externalRelationship = await xlsx({
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/workbook.xlsx" TargetMode="External"/>',
      "</Relationships>",
    ].join(""),
  });
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(externalRelationship, "external.xlsx", XLSX_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_XLSX_EXTERNAL_LINK"),
  );
  const entityEncodedExternalRelationship = await xlsx({
    "xl/_rels/workbook.xml.rels": [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/workbook.xlsx" TargetMode="Exter&#110;al"/>',
      "</Relationships>",
    ].join(""),
  });
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(entityEncodedExternalRelationship, "encoded-external.xlsx", XLSX_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_XLSX_EXTERNAL_LINK"),
  );

  for (const [name, entry] of [
    ["macro.xlsx", "xl/vbaProject.bin"],
    ["embedded.xlsx", "xl/embeddings/oleObject1.bin"],
  ] as const) {
    const unsafeWorkbook = await xlsx({ [entry]: Buffer.from([0x01, 0x02, 0x03]) });
    await assert.rejects(
      () => readValidatedPurchaseOrderDispatchAttachment(file(unsafeWorkbook, name, XLSX_MIME)),
      coded("PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT"),
    );
  }

  const relocatedActiveContent = await xlsx({
    "[Content_Types].xml": [
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      `<Override PartName="/xl/workbook.xml" ContentType="${XLSX_MIME}.main+xml"/>`,
      '<Override PartName="/evil/control.bin" ContentType="application/vnd.ms-office.activeX"/>',
      "</Types>",
    ].join(""),
    "evil/control.bin": Buffer.from([0x01, 0x02, 0x03]),
  });
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(relocatedActiveContent, "relocated-active-content.xlsx", XLSX_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT"),
  );

  const relocatedQueryRelationship = await xlsx({
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../evil/data.xml"/></Relationships>',
    "evil/data.xml": "<queryTable/>",
  });
  await assert.rejects(
    () => readValidatedPurchaseOrderDispatchAttachment(file(relocatedQueryRelationship, "relocated-query.xlsx", XLSX_MIME)),
    coded("PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT"),
  );
});

test("XLSX validator accepts ordinary formulas and calc chains", async () => {
  const safeWorkbook = await xlsx({
    "xl/calcChain.xml": '<calcChain><c r="A3" i="1"/></calcChain>',
    "xl/worksheets/sheet1.xml": [
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<sheetData><row><c><f>SUM(A1:A2)</f><v>3</v></c></row></sheetData>',
      '<conditionalFormatting><cfRule type="expression"><formula>A1&gt;0</formula></cfRule></conditionalFormatting>',
      "</worksheet>",
    ].join(""),
  });
  await assert.doesNotReject(
    () => readValidatedPurchaseOrderDispatchAttachment(file(safeWorkbook, "ordinary-formulas.xlsx", XLSX_MIME)),
  );

  const relocatedSafeWorkbook = await xlsx({
    "[Content_Types].xml": [
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      `<Override PartName="/xl/workbook.xml" ContentType="${XLSX_MIME}.main+xml"/>`,
      '<Override PartName="/unusual/sheet.dat" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      "</Types>",
    ].join(""),
    "unusual/sheet.dat": '<worksheet><sheetData><row><c><f>SUM(A1:A2)</f><v>3</v></c></row></sheetData></worksheet>',
  });
  await assert.doesNotReject(
    () => readValidatedPurchaseOrderDispatchAttachment(file(relocatedSafeWorkbook, "relocated-safe.xlsx", XLSX_MIME)),
  );
});

test("XLSX validator rejects connections, queries, and unsafe formulas", async () => {
  for (const [name, entries] of [
    ["connections.xlsx", { "xl/connections.xml": "<connections/>" }],
    ["query.xlsx", { "xl/queryTables/queryTable1.xml": "<queryTable/>" }],
    ["formula.xlsx", {
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>',
    }],
    ["namespaced-formula.xlsx", {
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c><x-evil:f xmlns:x-evil="http://schemas.openxmlformats.org/spreadsheetml/2006/main">WEBSERVICE("https://example.invalid")</x-evil:f></c></row></sheetData></worksheet>',
    }],
    ["conditional-formula.xlsx", {
      "xl/worksheets/sheet1.xml": '<worksheet><conditionalFormatting><cfRule><formula>WEBSERVICE("https://example.invalid")</formula></cfRule></conditionalFormatting></worksheet>',
    }],
    ["defined-name.xlsx", {
      "xl/workbook.xml": '<workbook><definedNames><definedName name="remote">HYPERLINK("https://example.invalid")</definedName></definedNames></workbook>',
    }],
    ["formula-attribute.xlsx", {
      "xl/pivotCache/pivotCacheDefinition1.xml": '<pivotCacheDefinition><calculatedItem formula="WEBSERVICE(&quot;https://example.invalid&quot;)"/></pivotCacheDefinition>',
    }],
    ["entity-obfuscated-formula.xlsx", {
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c><f>WEB&#83;ERVICE(&quot;https://example.invalid&quot;)</f></c></row></sheetData></worksheet>',
    }],
    ["relocated-formula.xlsx", {
      "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../evil/sheet1.xml"/></Relationships>',
      "evil/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><f>WEBSERVICE(&quot;https://example.invalid&quot;)</f></c></row></sheetData></worksheet>',
    }],
    ["relocated-nonstandard-extension-formula.xlsx", {
      "[Content_Types].xml": [
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        `<Override PartName="/xl/workbook.xml" ContentType="${XLSX_MIME}.main+xml"/>`,
        '<Override PartName="/evil/sheet.dat" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        "</Types>",
      ].join(""),
      "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../evil/sheet.dat"/></Relationships>',
      "evil/sheet.dat": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><f>WEBSERVICE(&quot;https://example.invalid&quot;)</f></c></row></sheetData></worksheet>',
    }],
    ["generic-dde.xlsx", {
      "xl/worksheets/sheet1.xml": "<worksheet><sheetData><row><c><f>regsvr32|'/s local.sct'!A0</f></c></row></sheetData></worksheet>",
    }],
    ["utf16le-formula.xlsx", {
      "xl/worksheets/sheet1.xml": utf16Xml('<?xml version="1.0" encoding="UTF-16"?><worksheet><sheetData><row><c><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>', "le"),
    }],
    ["utf16be-formula.xlsx", {
      "xl/worksheets/sheet1.xml": utf16Xml('<?xml version="1.0" encoding="UTF-16"?><worksheet><sheetData><row><c><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>', "be"),
    }],
    ["utf32le-formula.xlsx", {
      "xl/worksheets/sheet1.xml": utf32Xml('<?xml version="1.0" encoding="UTF-32"?><worksheet><sheetData><row><c><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>', "le"),
    }],
    ["utf32be-formula.xlsx", {
      "xl/worksheets/sheet1.xml": utf32Xml('<?xml version="1.0" encoding="UTF-32"?><worksheet><sheetData><row><c><f>WEBSERVICE("https://example.invalid")</f></c></row></sheetData></worksheet>', "be"),
    }],
    ["utf32le-safe.xlsx", {
      "xl/worksheets/sheet1.xml": utf32Xml('<?xml version="1.0" encoding="UTF-32"?><worksheet><sheetData/></worksheet>', "le"),
    }],
    ["utf32be-safe.xlsx", {
      "xl/worksheets/sheet1.xml": utf32Xml('<?xml version="1.0" encoding="UTF-32"?><worksheet><sheetData/></worksheet>', "be"),
    }],
  ] as const) {
    const unsafeWorkbook = await xlsx(entries);
    await assert.rejects(
      () => readValidatedPurchaseOrderDispatchAttachment(file(unsafeWorkbook, name, XLSX_MIME)),
      coded("PURCHASE_ORDER_ATTACHMENT_XLSX_ACTIVE_CONTENT"),
    );
  }
});

test("dispatch attachment snapshots are normalized, strictly validated, and use standardized mail names", () => {
  const snapshot = parseDispatchAttachmentSnapshot({
    assetId: "asset-1",
    sha256: "A".repeat(64),
    size: 321,
    mimeType: "APPLICATION/PDF",
    fileName: "../unsafe/path/采购明细.pdf",
  });
  assert.deepEqual(snapshot, {
    assetId: "asset-1",
    sha256: "a".repeat(64),
    size: 321,
    mimeType: PDF_MIME,
    fileName: "采购明细.pdf",
  });
  assert.equal(parseDispatchAttachmentSnapshot(""), null);

  for (const invalid of [
    { assetId: "", sha256: "a".repeat(64), size: 1, mimeType: PDF_MIME, fileName: "a.pdf" },
    { assetId: "asset-1", sha256: "not-a-sha", size: 1, mimeType: PDF_MIME, fileName: "a.pdf" },
    { assetId: "asset-1", sha256: "a".repeat(64), size: 0, mimeType: PDF_MIME, fileName: "a.pdf" },
    { assetId: "asset-1", sha256: "a".repeat(64), size: PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES + 1, mimeType: PDF_MIME, fileName: "a.pdf" },
    { assetId: "asset-1", sha256: "a".repeat(64), size: 1, mimeType: "text/plain", fileName: "a.txt" },
  ]) {
    assert.throws(
      () => parseDispatchAttachmentSnapshot(invalid),
      coded("PURCHASE_ORDER_ATTACHMENT_SNAPSHOT_INVALID"),
    );
  }

  assert.equal(
    purchaseOrderDispatchAttachmentEmailFileName("PV 258.xlsx", PDF_MIME),
    "PV-258-采购明细.pdf",
  );
  assert.equal(
    purchaseOrderDispatchAttachmentEmailFileName("PV258", XLSX_MIME),
    "PV258-采购明细.xlsx",
  );
});

test("Resend attachment payload sanitizes names, preserves MIME, and base64 encodes content", () => {
  assert.deepEqual(resendAttachmentPayload([{
    filename: '../private\r\n"bad".pdf',
    content: Buffer.from("supplier detail", "utf8"),
    contentType: "APPLICATION/PDF",
  }]), [{
    filename: "private_bad_.pdf",
    content: Buffer.from("supplier detail", "utf8").toString("base64"),
    content_type: PDF_MIME,
  }]);

  assert.throws(
    () => resendAttachmentPayload([{
      filename: "too-large.pdf",
      content: Buffer.alloc(10 * 1024 * 1024 + 1),
      contentType: PDF_MIME,
    }]),
    coded("NOTIFICATION_ATTACHMENT_SIZE_INVALID"),
  );
});

test("upload route authorizes and applies the multipart limit before reading form data", () => {
  const post = routeSource.slice(routeSource.indexOf("export async function POST"), routeSource.indexOf("export async function DELETE"));
  const permissionGuard = post.indexOf("requireApiWrite(request, \"salesExecution\")");
  const requestLimitGuard = post.indexOf("assertMultipartRequestWithinLimit(request)");
  const formDataRead = post.indexOf("request.formData()");
  assert.ok(permissionGuard >= 0 && permissionGuard < formDataRead);
  assert.ok(requestLimitGuard >= 0 && requestLimitGuard < formDataRead);
  assert.match(post, /confirmedSupplierSafe: formData\.get\("confirmedSupplierSafe"\)/);
});

test("attachment mutations stay draft-only and require explicit supplier-safe confirmation", () => {
  assert.match(attachmentSource, /requireDraft && \(order\.status !== "DRAFT" \|\| order\.execution\.status !== "DRAFT"\)/);
  assert.match(attachmentSource, /PURCHASE_ORDER_ATTACHMENT_LOCKED/);
  assert.match(attachmentSource, /String\(input\.confirmedSupplierSafe[\s\S]*!== "true"[\s\S]*PURCHASE_ORDER_ATTACHMENT_CONFIRMATION_REQUIRED/);
  assert.match(attachmentSource, /SELECT "id" FROM "factory_purchase_orders" WHERE "id" = \$\{purchaseOrderId\} FOR UPDATE/);
  assert.ok(
    attachmentSource.indexOf("PURCHASE_ORDER_ATTACHMENT_CONFIRMATION_REQUIRED")
      < attachmentSource.indexOf("readValidatedPurchaseOrderDispatchAttachment(input.file)"),
  );
  assert.match(attachmentSource, /deleteFactoryPurchaseOrderDispatchAttachment[\s\S]*resolvePurchaseOrder\(tx, validActor, executionId, purchaseOrderId, true\)/);
});

test("FileAsset binding and dispatch queue freeze role, hash, asset, and dispatch version", () => {
  assert.match(fileAssetSource, /FACTORY_PURCHASE_ORDERS: "factory_purchase_orders"/);
  assert.match(fileAssetSource, /PURCHASE_ORDER_ORIGINAL_DETAIL: "PURCHASE_ORDER_ORIGINAL_DETAIL"/);
  assert.match(attachmentSource, /fileRole: FILE_ASSET_ROLES\.PURCHASE_ORDER_ORIGINAL_DETAIL/);
  assert.match(attachmentSource, /contentSha256: sha256/);
  assert.match(attachmentSource, /bindingType: "FACTORY_PURCHASE_ORDER_DISPATCH_ATTACHMENT"/);

  assert.match(outboxSource, /dispatchAttachmentSnapshotFromAsset\(attachmentAsset\)/);
  assert.match(outboxSource, /context: \{[\s\S]*dispatchVersionNumber,[\s\S]*dispatchAttachment,[\s\S]*\}/);
  assert.match(outboxSource, /attachments: dispatchAttachment \? \[\{[\s\S]*assetId: dispatchAttachment\.assetId,[\s\S]*sha256: dispatchAttachment\.sha256/);
  assert.match(outboxSource, /attachmentSnapshots\.push\(\{ purchaseOrderId: order\.id, \.\.\.dispatchAttachment \}\)/);
  assert.match(dispatchSource, /dispatchAttachments: queued\.attachmentSnapshots/);
});

test("notification processor reads the frozen asset before send and records attachment failures", () => {
  const readFrozenAt = processorSource.indexOf("readFrozenFactoryPurchaseOrderDispatchAttachment(");
  const sendAt = processorSource.indexOf("sendNotificationEmail({", readFrozenAt);
  assert.ok(readFrozenAt >= 0 && readFrozenAt < sendAt);
  assert.doesNotMatch(processorSource, /readFrozenFactoryPurchaseOrderDispatchAttachment\([\s\S]{0,300}\.catch\(\(\) => \[\]\)/);
  assert.match(processorSource, /catch \(error: unknown\) \{[\s\S]*publicSendError\(error\)[\s\S]*status: "failed"[\s\S]*lastError: message/);
  assert.match(processorSource, /return \{[\s\S]*sent: false,[\s\S]*skipped: false,[\s\S]*error: message/);
  assert.match(snapshotSource, /PURCHASE_ORDER_ATTACHMENT_CHANGED/);
  assert.match(snapshotSource, /PURCHASE_ORDER_ATTACHMENT_INTEGRITY_FAILED/);
  assert.match(processorSource, /subjectOverride: row\.subject/);
  assert.match(processorSource, /bodyOverride: row\.body/);
  assert.match(validationSource, /PURCHASE_ORDER_DISPATCH_ATTACHMENT_MAX_BYTES/);
});

test("download and cleanup paths preserve attachment integrity and retry failed cleanup", () => {
  assert.match(attachmentSource, /actualSha256 !== expectedSha256/);
  assert.match(attachmentSource, /PURCHASE_ORDER_ATTACHMENT_INTEGRITY_FAILED/);
  assert.match(attachmentSource, /deleteManagedStoredFile\(stored\.storageKey\)[\s\S]*enqueueFileStorageDeletion\(prisma/);
  assert.match(routeSource, /bodyLength: attachment\.fileSize/);
  assert.doesNotMatch(routeSource, /disposition: "inline"/);
});

test("draft UI supports upload, replacement, deletion, and explicit safe-content confirmation", () => {
  assert.match(purchaseOrderListSource, /<PurchaseOrderDispatchAttachment[\s\S]*executionId=\{executionId\}[\s\S]*order=\{order\}/);
  assert.match(attachmentUiSource, /body\.set\("confirmedSupplierSafe", "true"\)/);
  assert.match(attachmentUiSource, /attachment \? "替换附件" : "上传附件"/);
  assert.match(attachmentUiSource, /method: "DELETE"/);
  assert.match(attachmentUiSource, /确认删除这份采购明细附件吗/);
  assert.match(attachmentUiSource, /我确认附件仅含供应商可见采购信息，不含客户资料、销售价格或利润/);
  assert.match(attachmentUiSource, /const editable = order\.status === "DRAFT"/);
});

test("factory purchase-order notification explicitly supports attachments", () => {
  assert.match(notificationDefinitionSource, /FACTORY_PURCHASE_ORDER_DISPATCH_NOTIFICATION_DEFINITION[\s\S]*supportsAttachments: true/);
});
