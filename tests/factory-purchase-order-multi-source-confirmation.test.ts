import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { readPrismaSchemaSource } from "./prisma-schema-source.ts";

const jiti = createJiti(import.meta.url);
const {
  normalizeOfflineFactoryResponseInput,
  normalizeOfflineProductionCompletionInput,
} = await jiti.import<
  typeof import("../lib/platform/factory-purchase-order-confirmation-inputs.ts")
>("../lib/platform/factory-purchase-order-confirmation-inputs.ts");
const { readValidatedConfirmationEvidenceUploadFile } = await jiti.import<
  typeof import("../lib/platform/upload-validation.ts")
>("../lib/platform/upload-validation.ts");
const {
  CONFIRMATION_EVIDENCE_MAX_BYTES,
  validateConfirmationEvidenceFile,
} = await jiti.import<
  typeof import("../app/modules/sales-execution/confirmation-evidence-upload.ts")
>("../app/modules/sales-execution/confirmation-evidence-upload.ts");
const {
  shanghaiDateTimeInputValue,
  shanghaiDateTimeIso,
} = await jiti.import<
  typeof import("../app/modules/sales-execution/offline-confirmation-values.ts")
>("../app/modules/sales-execution/offline-confirmation-values.ts");

const schema = readPrismaSchemaSource();
const migration = readFileSync(
  "prisma/migrations/20260815090000_factory_offline_confirmations/migration.sql",
  "utf8",
);
const workflowClosureMigration = readFileSync(
  "prisma/migrations/20260810043000_factory_purchase_workflow_closure/migration.sql",
  "utf8",
);
const responseCore = readFileSync(
  "lib/platform/factory-purchase-order-response-core.ts",
  "utf8",
);
const dispatchService = readFileSync(
  "lib/platform/sales-execution-dispatch.ts",
  "utf8",
);
const fileAssetData = readFileSync("lib/platform/file-asset-data.ts", "utf8");
const evidenceService = readFileSync(
  "lib/platform/factory-purchase-order-confirmation-evidence.ts",
  "utf8",
);
const evidenceUploadRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/confirmation-evidence/route.ts",
  "utf8",
);
const evidenceReadRoute = readFileSync(
  "app/api/sales-executions/[id]/purchase-orders/[purchaseOrderId]/confirmation-evidence/[eventKind]/[eventId]/route.ts",
  "utf8",
);
const uploadValidation = readFileSync("lib/platform/upload-validation.ts", "utf8");
const evidenceUploadUi = readFileSync(
  "app/modules/sales-execution/confirmation-evidence-upload.ts",
  "utf8",
);
const confirmationEventSerialization = readFileSync(
  "lib/platform/sales-execution-confirmation-events.ts",
  "utf8",
);

function filesUnder(root: string): Array<{ path: string; source: string }> {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

const platformSources = filesUnder("lib/platform");
const routeSources = filesUnder("app/api").filter(({ path }) => path.endsWith("route.ts"));
const applicationSources = filesUnder("app/modules");

function combined(sources: Array<{ source: string }>) {
  return sources.map(({ source }) => source).join("\n");
}

function prismaModel(name: string) {
  return schema.match(new RegExp(`model ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

function prismaEnum(name: string) {
  return schema.match(new RegExp(`enum ${name}\\b[\\s\\S]*?\\n\\}`))?.[0] || "";
}

test("factory confirmations store one explicit portal or offline attribution contract", () => {
  const source = prismaEnum("FactoryConfirmationSource");
  const channel = prismaEnum("FactoryConfirmationChannel");
  const response = prismaModel("FactoryPurchaseOrderSupplierResponse");
  const purchaseOrder = prismaModel("FactoryPurchaseOrder");

  assert.match(source, /SUPPLIER_PORTAL/);
  assert.match(source, /INTERNAL_OFFLINE/);
  for (const value of ["PORTAL", "WECHAT", "PHONE", "EMAIL", "PAPER", "OTHER"]) {
    assert.match(channel, new RegExp(`\\b${value}\\b`));
  }

  assert.match(response, /source\s+FactoryConfirmationSource/);
  assert.match(response, /channel\s+FactoryConfirmationChannel/);
  assert.match(response, /supplierContact\s+String\s+@map\("supplier_contact"\)/);
  assert.match(response, /supplierRespondedAt\s+DateTime\s+@map\("supplier_responded_at"\)/);
  assert.match(response, /evidenceNote\s+String\?/);

  assert.match(purchaseOrder, /productionCompletionSource\s+FactoryConfirmationSource\?/);
  assert.match(purchaseOrder, /productionCompletionChannel\s+FactoryConfirmationChannel\?/);
  assert.match(purchaseOrder, /productionCompletionContact\s+String\?/);
  assert.match(purchaseOrder, /productionCompletionRecordedAt\s+DateTime\?/);
  assert.match(purchaseOrder, /productionCompletionEvidenceNote\s+String\?/);
});

test("forward migration backfills history and keeps the optional evidence note immutable", () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
  assert.match(migration, /SET LOCAL statement_timeout = '2min'/);
  assert.match(migration, /UPDATE "factory_purchase_order_supplier_responses"[\s\S]*?"source" = 'SUPPLIER_PORTAL'/);
  assert.match(migration, /UPDATE "factory_purchase_orders"[\s\S]*?THEN 'SUPPLIER_PORTAL'[\s\S]*?ELSE 'INTERNAL_OFFLINE'/);
  assert.match(migration, /"evidence_note" IS NULL OR CHAR_LENGTH\("evidence_note"\) <= 2000/);
  assert.match(migration, /"production_completion_evidence_note" IS NULL OR CHAR_LENGTH\("production_completion_evidence_note"\) <= 2000/);
  assert.doesNotMatch(migration, /"evidence_note" IS NOT NULL/);
  assert.doesNotMatch(migration, /"production_completion_evidence_note" IS NOT NULL/);
  assert.match(migration, /NEW\."source" IS DISTINCT FROM OLD\."source"/);
  assert.match(migration, /NEW\."evidence_note" IS DISTINCT FROM OLD\."evidence_note"/);
  assert.match(migration, /NEW\."production_completion_source" IS DISTINCT FROM OLD\."production_completion_source"/);
  assert.match(migration, /NEW\."production_completion_evidence_note" IS DISTINCT FROM OLD\."production_completion_evidence_note"/);
  const responseTriggerOff = migration.indexOf(
    'ALTER TABLE "factory_purchase_order_supplier_responses" DISABLE TRIGGER USER;',
  );
  const responseBackfill = migration.indexOf(
    'UPDATE "factory_purchase_order_supplier_responses" response',
  );
  const responseTriggerOn = migration.indexOf(
    'ALTER TABLE "factory_purchase_order_supplier_responses" ENABLE TRIGGER USER;',
  );
  const completionTriggerOff = migration.indexOf(
    'ALTER TABLE "factory_purchase_orders" DISABLE TRIGGER USER;',
  );
  const completionBackfill = migration.indexOf('UPDATE "factory_purchase_orders" purchase_order');
  const completionTriggerOn = migration.indexOf(
    'ALTER TABLE "factory_purchase_orders" ENABLE TRIGGER USER;',
  );
  assert.ok(
    responseTriggerOff >= 0
      && responseTriggerOff < responseBackfill
      && responseBackfill < responseTriggerOn,
    "historic response attribution must be backfilled only while its user triggers are suspended",
  );
  assert.ok(
    completionTriggerOff >= 0
      && completionTriggerOff < completionBackfill
      && completionBackfill < completionTriggerOn,
    "historic completion attribution must be backfilled only while its user triggers are suspended",
  );
  assert.equal(migration.match(/DISABLE TRIGGER USER;/g)?.length, 2);
  assert.equal(migration.match(/ENABLE TRIGGER USER;/g)?.length, 2);
  assert.doesNotMatch(migration, /DISABLE TRIGGER ALL/);
  assert.match(migration, /COMMIT;\s*$/);
});

test("database actor guards validate portal and internal sources independently", () => {
  assert.match(migration, /IF NEW\."source" = 'SUPPLIER_PORTAL'/);
  assert.match(migration, /ELSIF NEW\."source" = 'INTERNAL_OFFLINE'/);
  assert.match(migration, /parent\.actor_supplier_id IS DISTINCT FROM parent\.supplier_id/);
  assert.match(migration, /parent\.actor_supplier_id IS NOT NULL/);
  assert.match(migration, /NEW\."channel" = 'PORTAL'/);
  assert.match(migration, /NEW\."supplier_responded_at" < parent\."dispatched_at"/);
  assert.match(migration, /NEW\."supplier_responded_at" > NEW\."responded_at"/);

  assert.match(migration, /NEW\."production_completion_source" = 'SUPPLIER_PORTAL'/);
  assert.match(migration, /NEW\."production_completion_source" = 'INTERNAL_OFFLINE'/);
  assert.match(migration, /completion_user\."supplier_id" = NEW\."supplier_id"/);
  assert.match(migration, /completion_user\."supplier_id" IS NULL/);
  assert.match(migration, /factory purchase order completion source and recorder are invalid/);
});

test("rolling response compatibility runs in the real before-insert guard after parent validation", () => {
  assert.match(
    workflowClosureMigration,
    /CREATE TRIGGER "factory_purchase_order_supplier_response_actor_guard"\s+BEFORE INSERT ON "factory_purchase_order_supplier_responses"\s+FOR EACH ROW EXECUTE FUNCTION "validate_supplier_purchase_order_response_actor"\(\)/,
  );
  const actorGuard = migration.match(
    /CREATE OR REPLACE FUNCTION "validate_supplier_purchase_order_response_actor"\(\) RETURNS trigger AS \$\$[\s\S]*?\$\$ LANGUAGE plpgsql;/,
  )?.[0] || "";
  const parentLoaded = actorGuard.indexOf("INTO parent");
  const missingParentRejected = actorGuard.indexOf("IF NOT FOUND THEN");
  const firstParentAccess = actorGuard.indexOf("parent.");
  const compatibilityFill = actorGuard.indexOf("Old inserts receive the new attribution columns");
  assert.ok(
    parentLoaded >= 0
      && missingParentRejected > parentLoaded
      && compatibilityFill > missingParentRejected
      && firstParentAccess > missingParentRejected,
    "the guard must reject a missing parent before compatibility code reads parent fields",
  );
  assert.match(actorGuard, /IF NEW\."source" = 'SUPPLIER_PORTAL' THEN/);
  assert.match(actorGuard, /NEW\."channel" := 'PORTAL'/);
  assert.match(actorGuard, /NEW\."supplier_contact" := COALESCE[\s\S]*?parent\.actor_name/);
  assert.match(
    actorGuard,
    /NEW\."supplier_responded_at" := COALESCE\(NEW\."supplier_responded_at", NEW\."responded_at"\)/,
  );
});

test("rolling migration fills attribution for completion writes from the previous portal release", () => {
  const compatibilityBlock = migration.match(
    /-- Keep the previous portal release write-compatible[\s\S]*?(?=\n  IF OLD\."replacement_for_id")/,
  )?.[0] || "";

  assert.match(compatibilityBlock, /OLD\."production_status" IS DISTINCT FROM 'COMPLETED'/);
  assert.match(compatibilityBlock, /NEW\."production_status" = 'COMPLETED'/);
  assert.match(compatibilityBlock, /NEW\."production_completion_source" IS NULL/);
  assert.match(compatibilityBlock, /WHERE completion_user\."id" = NEW\."production_completed_by"/);
  assert.match(
    compatibilityBlock,
    /legacy_completion_actor\."supplier_id" IS NOT DISTINCT FROM NEW\."supplier_id"[\s\S]*?THEN 'SUPPLIER_PORTAL'::"FactoryConfirmationSource"/,
  );
  assert.match(compatibilityBlock, /THEN 'PORTAL'::"FactoryConfirmationChannel"/);
  assert.match(compatibilityBlock, /NEW\."production_completion_contact" := LEFT/);
  assert.match(
    compatibilityBlock,
    /NEW\."production_completion_recorded_at" := NEW\."production_completed_at"/,
  );
});

test("offline input normalization fixes the source and never requires evidence", () => {
  const respondedAt = "2026-08-15T08:30:00+08:00";
  const response = normalizeOfflineFactoryResponseInput({
    expectedRevision: 7,
    channel: "wechat",
    supplierContact: " 王师傅 ",
    supplierRespondedAt: respondedAt,
    source: "SUPPLIER_PORTAL",
  });
  assert.deepEqual(response, {
    expectedRevision: 7,
    attribution: {
      source: "INTERNAL_OFFLINE",
      channel: "WECHAT",
      supplierContact: "王师傅",
      supplierRespondedAt: new Date(respondedAt),
      evidenceNote: "",
    },
  });

  const completedAt = "2026-08-15T09:00:00+08:00";
  const completion = normalizeOfflineProductionCompletionInput({
    expectedRevision: 8,
    channel: "PHONE",
    supplierContact: "李主管",
    productionCompletedAt: completedAt,
  });
  assert.equal(completion.attribution.source, "INTERNAL_OFFLINE");
  assert.equal(completion.attribution.evidenceNote, "");
  assert.equal(completion.attribution.productionCompletedAt.toISOString(), new Date(completedAt).toISOString());
});

test("offline attribution rejects portal spoofing and only bounds the optional evidence note", () => {
  const base = {
    expectedRevision: 2,
    supplierContact: "供应商联系人",
    supplierRespondedAt: "2026-08-15T08:30:00+08:00",
  };
  assert.throws(
    () => normalizeOfflineFactoryResponseInput({ ...base, channel: "PORTAL" }),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_CONFIRMATION_CHANNEL_INVALID",
  );
  assert.throws(
    () => normalizeOfflineFactoryResponseInput({ ...base, channel: "PHONE", evidence: "x".repeat(2_001) }),
    (error: unknown) => (error as { code?: string }).code === "FACTORY_CONFIRMATION_EVIDENCE_TOO_LONG",
  );
});

test("offline confirmation local datetimes preserve seconds and accept browser-normalized minutes", () => {
  const beforeMinuteBoundary = new Date("2026-08-15T00:00:59.000Z");
  const afterMinuteBoundary = new Date("2026-08-15T00:01:00.000Z");

  assert.equal(shanghaiDateTimeInputValue(beforeMinuteBoundary), "2026-08-15T08:00:59");
  assert.equal(shanghaiDateTimeInputValue(afterMinuteBoundary), "2026-08-15T08:01:00");
  assert.equal(
    shanghaiDateTimeIso("2026-08-15T08:00:59"),
    "2026-08-15T00:00:59.000Z",
  );
  assert.equal(
    shanghaiDateTimeIso("2026-08-15T08:00"),
    "2026-08-15T00:00:00.000Z",
    "browsers may normalize a zero-second datetime-local value to minute precision",
  );

  const responseUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-offline-response.tsx")
  ))?.source || "";
  const completionUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-offline-production-completion.tsx")
  ))?.source || "";
  const responseInput = responseUi.match(
    /<input type="datetime-local"[^>]*value=\{supplierRespondedAt\}[^>]*>/,
  )?.[0] || "";
  const completionInput = completionUi.match(
    /<input type="datetime-local"[^>]*value=\{productionCompletedAt\}[^>]*>/,
  )?.[0] || "";

  assert.match(responseInput, /\bstep=\{1\}/);
  assert.match(completionInput, /\bstep=\{1\}/);
});

test("confirmation evidence is an optional scoped FileAsset uploaded separately from the business event", () => {
  assert.match(fileAssetData, /FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES/);
  assert.match(fileAssetData, /FACTORY_PURCHASE_ORDERS/);
  assert.match(fileAssetData, /SUPPLIER_CONFIRMATION_EVIDENCE/);
  assert.match(fileAssetData, /PRODUCTION_COMPLETION_EVIDENCE/);

  assert.match(evidenceUploadRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(evidenceUploadRoute, /request\.formData\(\)/);
  assert.match(evidenceUploadRoute, /eventKind: formData\.get\("eventKind"\)/);
  assert.match(evidenceUploadRoute, /eventId: formData\.get\("eventId"\)/);
  assert.match(evidenceUploadRoute, /file: formData\.get\("file"\)/);
  assert.doesNotMatch(evidenceUploadRoute, /formData\.get\("(?:sourceTable|sourceId|fileRole)"\)/);

  assert.match(evidenceService, /salesExecutionAccessWhere\(actor\)/);
  assert.match(evidenceService, /response\.source !== "INTERNAL_OFFLINE"/);
  assert.match(evidenceService, /order\.productionCompletionSource !== "INTERNAL_OFFLINE"/);
  assert.match(evidenceService, /sourceTable: FILE_ASSET_SOURCE_TABLES\.FACTORY_PURCHASE_ORDER_SUPPLIER_RESPONSES/);
  assert.match(evidenceService, /sourceTable: FILE_ASSET_SOURCE_TABLES\.FACTORY_PURCHASE_ORDERS/);
  assert.match(evidenceService, /fileRole: FILE_ASSET_ROLES\.SUPPLIER_CONFIRMATION_EVIDENCE/);
  assert.match(evidenceService, /fileRole: FILE_ASSET_ROLES\.PRODUCTION_COMPLETION_EVIDENCE/);

  assert.match(uploadValidation, /readValidatedConfirmationEvidenceUploadFile/);
  assert.match(uploadValidation, /"pdf" \| "jpg" \| "jpeg" \| "png" \| "webp"/);
  assert.match(uploadValidation, /readValidatedPdfUploadFile/);
  assert.match(uploadValidation, /readValidatedPaymentVoucherUploadFile/);
  assert.match(uploadValidation, /FILE_SIGNATURE_INVALID/);
  assert.match(uploadValidation, /10MB/);
  assert.doesNotMatch(responseCore, /uploadFactoryConfirmationEvidence/);
  const confirmationServices = combined(platformSources.filter(({ path }) => (
    /offline-(?:response|production)\.ts$/.test(path)
  )));
  const confirmationRoutes = combined(routeSources.filter(({ path }) => (
    /offline-(?:response|production-completion)\/route\.ts$/.test(path)
  )));
  assert.doesNotMatch(confirmationServices, /uploadFactoryConfirmationEvidence/);
  assert.match(confirmationRoutes, /parseJsonBody\(request\)/);
  assert.doesNotMatch(confirmationRoutes, /request\.formData\(\)/);
});

test("replacing confirmation evidence defers only the old object through the deletion outbox", () => {
  const grace = evidenceService.match(
    /const REPLACED_EVIDENCE_DELETE_GRACE_MS = (\d+) \* 60 \* 1000;/,
  );
  assert.ok(grace, "replacement deletion grace must be an explicit number of minutes");
  assert.ok(Number(grace[1]) > 5, "replacement deletion grace must exceed five minutes");

  const replacementBranch = evidenceService.match(
    /if \(previousStorageKey && previousStorageKey !== stored\.storageKey\) \{[\s\S]*?\n\s*\}/,
  )?.[0] || "";
  assert.match(replacementBranch, /await enqueueFileStorageDeletion\(tx, \{/);
  assert.match(replacementBranch, /storageKey: previousStorageKey/);
  assert.match(
    replacementBranch,
    /deleteAfter: new Date\(Date\.now\(\) \+ REPLACED_EVIDENCE_DELETE_GRACE_MS\)/,
  );
  assert.doesNotMatch(
    replacementBranch,
    /deleteManagedStoredFile|deleteR2Object|removeManagedStoredFile/,
    "the successful replacement transaction must not synchronously delete the old object",
  );
  assert.doesNotMatch(evidenceService, /deleteManagedStoredFile\(previousStorageKey/);
  assert.match(
    evidenceService,
    /catch \(error: unknown\) \{\s*await deleteManagedStoredFile\(stored\.storageKey\)/,
    "transaction failure may clean up only the newly uploaded object",
  );
});

test("confirmation evidence GET and HEAD responses are private and never cached", () => {
  const getHandler = evidenceReadRoute.match(
    /export async function GET[\s\S]*?(?=\nexport async function HEAD)/,
  )?.[0] || "";
  const headHandler = evidenceReadRoute.match(
    /export async function HEAD[\s\S]*$/,
  )?.[0] || "";

  assert.match(getHandler, /"Cache-Control": "private, no-store"/);
  assert.match(headHandler, /"Cache-Control": "private, no-store"/);
  assert.match(headHandler, /readFactoryConfirmationEvidence\([\s\S]*?false,/);
});

test("confirmation evidence accepts validated PDF and image signatures", async () => {
  const files = [
    new File([Buffer.from("%PDF-1.7\n")], "reply.pdf", { type: "application/pdf" }),
    new File([Buffer.from([0xff, 0xd8, 0xff, 0x00])], "reply.jpg", { type: "image/jpeg" }),
    new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "reply.png", { type: "image/png" }),
    new File([Buffer.from("RIFF0000WEBP")], "reply.webp", { type: "image/webp" }),
  ];
  for (const file of files) {
    const validated = await readValidatedConfirmationEvidenceUploadFile(file);
    assert.equal(validated.originalFileName, file.name);
    assert.equal(validated.fileSize, file.size);
  }
  await assert.rejects(
    readValidatedConfirmationEvidenceUploadFile(
      new File([Buffer.from("not-a-pdf")], "forged.pdf", { type: "application/pdf" }),
    ),
    (error: unknown) => (error as { code?: string }).code === "FILE_SIGNATURE_INVALID",
  );
});

test("optional confirmation evidence has matching browser-side type and size guards", () => {
  for (const [name, mimeType] of [
    ["reply.pdf", "application/pdf"],
    ["reply.jpg", "image/jpeg"],
    ["reply.jpeg", "image/jpeg"],
    ["reply.png", "image/png"],
    ["reply.webp", "image/webp"],
  ] as const) {
    assert.equal(validateConfirmationEvidenceFile(new File(["valid"], name, { type: mimeType })), "");
  }
  assert.equal(validateConfirmationEvidenceFile(null), "", "no attachment must remain a valid submission");
  assert.match(
    validateConfirmationEvidenceFile(new File(["invalid"], "reply.txt", { type: "text/plain" })),
    /仅支持 PDF、JPG、JPEG、PNG、WebP/,
  );
  assert.match(
    validateConfirmationEvidenceFile(new File([
      new Uint8Array(CONFIRMATION_EVIDENCE_MAX_BYTES + 1),
    ], "large.pdf", { type: "application/pdf" })),
    /不能超过 10MB/,
  );
  assert.match(evidenceUploadUi, /const body = new FormData\(\)/);
  assert.match(evidenceUploadUi, /body\.set\("eventKind", eventKind\)/);
  assert.match(evidenceUploadUi, /body\.set\("eventId", eventId\)/);
  assert.match(evidenceUploadUi, /body\.set\("file", file\)/);
  assert.match(evidenceUploadUi, /timeoutMs: 60_000/);
});

test("offline forms commit the business event before attempting an optional evidence upload", () => {
  const responseUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-offline-response.tsx")
  ))?.source || "";
  const completionUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-offline-production-completion.tsx")
  ))?.source || "";

  for (const [label, source] of [
    ["response", responseUi],
    ["completion", completionUi],
  ] as const) {
    const saveIndex = source.indexOf("const result = await apiJson");
    const optionalUploadIndex = source.indexOf("if (evidenceFile)");
    const uploadIndex = source.indexOf("await uploadConfirmationEvidence");
    const refreshIndex = source.indexOf("await onChanged()");
    assert.ok(
      saveIndex >= 0
        && optionalUploadIndex > saveIndex
        && uploadIndex > optionalUploadIndex
        && refreshIndex > uploadIndex,
      `${label} must save, optionally upload, then refresh in that order`,
    );
    assert.match(source, /确认凭证（选填）/);
    assert.match(source, /<input type="file" accept=\{CONFIRMATION_EVIDENCE_ACCEPT\}/);
    assert.match(source, /catch \(uploadError\)[\s\S]*?确认凭证上传失败[\s\S]*?稍后补传/);
    assert.match(source, /evidenceNote: evidenceNote\.trim\(\)/);
  }

  assert.match(responseUi, /eventKind: "SUPPLIER_RESPONSE"/);
  assert.match(responseUi, /eventId: saved\.responseId/);
  assert.match(completionUi, /eventKind: "PRODUCTION_COMPLETION"/);
  assert.match(completionUi, /eventId: saved\?\.purchaseOrderId \|\| order\.id/);
});

test("confirmation history supports viewing and later evidence replacement without changing portal events", () => {
  const auditUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-confirmation-audit.tsx")
  ))?.source || "";
  const executionPanel = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-execution-panel.tsx")
  ))?.source || "";

  assert.match(confirmationEventSerialization, /eventId: String\(order\.id \|\| ""\)/);
  assert.match(confirmationEventSerialization, /kind: "PRODUCTION_COMPLETION"/);
  assert.match(confirmationEventSerialization, /eventId: response\.id/);
  assert.match(confirmationEventSerialization, /kind: "SUPPLIER_RESPONSE"/);
  assert.match(confirmationEventSerialization, /previewUrl: evidencePath/);
  assert.match(confirmationEventSerialization, /downloadUrl: `\$\{evidencePath\}\?download=1`/);

  assert.match(auditUi, /event\.kind === "PRODUCTION_COMPLETION"/);
  assert.match(auditUi, /uploadable = canManage && event\.source === "INTERNAL_OFFLINE"/);
  assert.match(auditUi, /evidence\?\.previewUrl[\s\S]*?>查看<\/a>/);
  assert.match(auditUi, /evidence\?\.downloadUrl[\s\S]*?>下载<\/a>/);
  assert.match(auditUi, /fileName \? "替换凭证" : "补传凭证"/);
  assert.match(auditUi, /await uploadConfirmationEvidence\(\{ executionId, purchaseOrderId: order\.id, eventKind: kind, eventId: targetId, file \}\)/);
  assert.match(auditUi, /await onChanged\(\)/);
  assert.match(executionPanel, /<PurchaseOrderConfirmationAudit executionId=\{executionId\} order=\{order\} canManage=\{canStartProduction\} onChanged=\{onChanged\} \/>/);
});

test("portal and offline responses share one state machine while source stays server-owned", () => {
  assert.match(responseCore, /export async function applyFactoryPurchaseOrderResponse/);
  assert.match(responseCore, /normalizeSupplierPurchaseOrderResponse/);
  assert.match(responseCore, /normalizeSupplierPurchaseOrderPrices/);
  assert.match(responseCore, /response\.expectedRevision !== before\.revision/);
  assert.match(responseCore, /factoryPurchaseOrderSupplierResponse\.create/);
  assert.match(responseCore, /source: attribution\.source/);
  assert.match(responseCore, /channel: attribution\.channel/);
  assert.match(responseCore, /evidenceNote: attribution\.evidenceNote \|\| null/);
  assert.doesNotMatch(responseCore, /source:\s*(?:rawInput|input|body)\./);

  const callers = platformSources.filter(({ path, source }) => (
    path !== "lib/platform/factory-purchase-order-response-core.ts"
    && /applyFactoryPurchaseOrderResponse\(/.test(source)
  ));
  assert.ok(callers.length >= 2, "portal and internal response services must both call the shared core");
  assert.match(combined(callers), /source:\s*"SUPPLIER_PORTAL"/);
  assert.match(combined(callers), /normalizeOfflineFactoryResponseInput/);
  assert.match(combined(callers), /attribution:\s*normalized\.attribution/);
});

test("the first non-rejected response confirms every line while preserving later price immutability", () => {
  assert.match(
    responseCore,
    /normalizeSupplierPurchaseOrderPrices\(rawInput, before\.items, \{[\s\S]*?allowOriginalPriceOverride: before\.status === "DISPATCHED" && before\.supplierResponseSequence === 0/,
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION "validate_factory_purchase_order_supplier_price"/);
  assert.match(migration, /response\."id" = NEW\."supplier_response_id"/);
  assert.match(migration, /NEW\."confirmed_by" IS DISTINCT FROM response_actor_id/);
  assert.match(migration, /IF parent_response_sequence <> 0 THEN/);
  assert.doesNotMatch(
    migration,
    /IF original_unit_price IS NOT NULL AND parent_response_sequence <> 0 THEN/,
    "a missing dispatched price must not let a second or later response introduce supplier prices",
  );
});

test("portal and internal routes keep separate authentication boundaries", () => {
  const portalResponseRoute = routeSources.find(({ path }) => (
    path.endsWith("supplier-purchase-orders/[id]/response/route.ts")
  ))?.source || "";
  const internalResponseRoute = routeSources.find(({ path }) => (
    path.endsWith("sales-executions/[id]/purchase-orders/[purchaseOrderId]/offline-response/route.ts")
  ))?.source || "";
  const internalCompletionRoute = routeSources.find(({ path }) => (
    path.endsWith("sales-executions/[id]/purchase-orders/[purchaseOrderId]/offline-production-completion/route.ts")
  ))?.source || "";

  assert.match(portalResponseRoute, /requireApiWrite\(request, "supplierPurchaseOrders"\)/);
  assert.match(internalResponseRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(internalResponseRoute, /offline|Offline/);
  assert.match(internalCompletionRoute, /requireApiWrite\(request, "salesExecution"\)/);
  assert.match(internalCompletionRoute, /offline|Offline/);
});

test("portal and internal production completion use the same attributed completion contract", () => {
  const completionCore = platformSources.find(({ path }) => (
    path.endsWith("factory-purchase-order-production-completion-core.ts")
  ))?.source || "";
  const completionCallers = platformSources.filter(({ path, source }) => (
    !path.endsWith("factory-purchase-order-production-completion-core.ts")
    && /applyFactoryPurchaseOrderProductionCompletion\(/.test(source)
  ));
  const callerSource = combined(completionCallers);

  assert.match(completionCore, /productionStatus:\s*"COMPLETED"/);
  assert.match(completionCore, /productionCompletionEvidenceNote:[\s\S]*?\|\| null/);
  assert.match(completionCore, /productionCompletionRecordedAt/);
  assert.match(completionCore, /revision:\s*\{ increment: 1 \}/);
  assert.match(callerSource, /source:\s*"SUPPLIER_PORTAL"/);
  assert.match(callerSource, /normalizeOfflineProductionCompletionInput/);
  assert.match(callerSource, /attribution:\s*normalized\.attribution/);
  assert.doesNotMatch(completionCore, /productionCompletionSource:\s*(?:input|body|rawInput)\./);
});

test("a completed order is idempotent only for the same confirmation source", () => {
  const completionCore = platformSources.find(({ path }) => (
    path.endsWith("factory-purchase-order-production-completion-core.ts")
  ))?.source || "";
  const completedBranch = completionCore.match(
    /if \(before\.productionStatus === "COMPLETED"\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";

  assert.match(completedBranch, /before\.productionCompletionSource !== attribution\.source/);
  assert.match(
    completedBranch,
    /codedError\([\s\S]*?409,[\s\S]*?"FACTORY_PRODUCTION_ALREADY_COMPLETED_BY_OTHER_SOURCE"/,
  );
  assert.ok(
    completedBranch.indexOf("FACTORY_PRODUCTION_ALREADY_COMPLETED_BY_OTHER_SOURCE")
      < completedBranch.indexOf("return { changed: false"),
    "cross-source retries must conflict before the same-source idempotent return",
  );
});

test("missing portal recipients do not block dispatch and remain a notification outcome", () => {
  assert.doesNotMatch(dispatchService, /PURCHASE_SUPPLIER_PORTAL_UNAVAILABLE/);
  assert.doesNotMatch(dispatchService, /throw codedError\([\s\S]{0,300}recipientEmails\.length/);
  assert.match(dispatchService, /missingRecipient/);
  assert.match(dispatchService, /queueFactoryPurchaseOrderDispatchOutbox/);
});

test("internal response UI submits every first-response price and prefills the dispatched price", () => {
  const responseUi = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/purchase-order-offline-response.tsx")
  ))?.source || "";
  const responseValues = applicationSources.find(({ path }) => (
    path.endsWith("sales-execution/offline-confirmation-values.ts")
  ))?.source || "";

  assert.match(responseUi, /supplierResponseSequence \|\| 0\) === 0 && action !== "REJECTED"/);
  assert.match(responseUi, /initialOfflineItemPrices\(order\)/);
  assert.match(responseUi, /itemPrices: \(order\.items \|\| \[\]\)\.map/);
  assert.doesNotMatch(responseUi, /\.filter\(\(item\) => item\.priceRequired\)[\s\S]{0,200}itemPrices/);
  assert.match(responseValues, /Object\.fromEntries\(\(order\.items \|\| \[\]\)[\s\S]*?\.map/);
  assert.doesNotMatch(responseValues, /priceRequired/);
  assert.match(responseValues, /supplierConfirmedUnitPrice \?\? item\.purchaseUnitPrice \?\? item\.unitPrice/);
  assert.match(responseUi, /依据说明（选填）/);
  assert.match(responseUi, /evidenceNote: evidenceNote\.trim\(\)/);
  assert.doesNotMatch(responseUi, /source\s*:/);
});
