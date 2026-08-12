import { prisma } from "../prisma";
import { safeFileName } from "../r2";
import { renderQuotationProformaInvoicePdf } from "./quotation-pdf";
import { assertQuotationPdfTemplateCanRender } from "./quotation-pdf-input";
import type { QuotationProformaInvoiceSnapshot } from "./quotation-pdf-types";
import { loadQuotation, type QuotationClient } from "./quotation-query-service";
import { lockQuotationForEmailMutation } from "./quotation-email-delivery-claim";
import {
  assertQuotationCurrencyBankAccountSnapshot,
  assertQuotationSellerSnapshot,
} from "./quotation-seller-snapshot";
import {
  assertQuotationDocumentBody,
  QUOTATION_DOCUMENT_MAX_BYTES,
  quotationDocumentStorageKey,
  validQuotationDocumentSha256,
} from "./quotation-document-integrity";
import {
  readQuotationDocumentObject,
  storeQuotationDocumentObject,
} from "./quotation-document-storage";
import { assertJsonObject, assertRead, assertWrite, codedError, writeAudit } from "./shared";
import type { QuotationActor } from "./quotation-values";

const SOURCE_TABLE = "sales_quotation_versions";
const FILE_ROLE = "PROFORMA_INVOICE";
const MIME_TYPE = "application/pdf";

type AuditRequest = Parameters<typeof writeAudit>[0];
type LoadedQuotation = Awaited<ReturnType<typeof loadQuotation>>;
type LoadedVersion = LoadedQuotation["versions"][number];

function normalizedVersionNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const versionNumber = Number(value);
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) {
    throw codedError("报价版本号无效", 400, "QUOTATION_VERSION_INVALID");
  }
  return versionNumber;
}

function quotationVersion(quotation: LoadedQuotation, value: unknown) {
  const versionNumber = normalizedVersionNumber(value, quotation.currentVersionNumber);
  const version = quotation.versions.find((item) => item.versionNumber === versionNumber);
  if (!version) throw codedError("报价版本不存在", 404, "QUOTATION_VERSION_NOT_FOUND");
  if (!version.sealedAt) throw codedError("报价版本尚未封存", 409, "QUOTATION_VERSION_NOT_SEALED");
  assertQuotationSellerSnapshot(version);
  return version;
}

function isoDate(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function productDescription(item: LoadedVersion["items"][number]) {
  const name = item.productNameSnapshot.trim();
  const specification = String(item.specificationSnapshot || "").trim();
  if (!specification || name.toLowerCase().includes(specification.toLowerCase())) return name;
  return `${name} (${specification})`;
}

export function quotationPdfSnapshot(
  quotation: LoadedQuotation,
  version: LoadedVersion,
): QuotationProformaInvoiceSnapshot {
  assertQuotationSellerSnapshot(version);
  return {
    quotationId: quotation.id,
    quotationVersionId: version.id,
    quoteNo: quotation.quoteNo,
    invoiceNo: version.invoiceNoSnapshot || quotation.quoteNo,
    versionNumber: version.versionNumber,
    quoteDate: isoDate(version.quoteDate) || "",
    validUntil: isoDate(version.validUntil),
    currency: version.currency,
    seller: {
      legalName: String(version.sellerNameEnSnapshot),
      address: version.sellerAddressSnapshot,
      email: version.sellerEmailSnapshot,
      phone: version.sellerPhoneSnapshot,
      website: version.sellerWebsiteSnapshot,
      bankAccount: version.sellerBankAccountSnapshot,
    },
    buyer: {
      legalName: version.customerNameSnapshot,
      country: version.countrySnapshot,
      contactPerson: version.contactPersonSnapshot,
      email: version.contactEmailSnapshot,
      phone: version.contactPhoneSnapshot,
    },
    items: version.items.map((item) => ({
      lineNumber: item.lineNumber,
      description: productDescription(item),
      unit: item.unitSnapshot,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      amount: item.amount.toString(),
      remark: item.remark,
    })),
    subtotal: version.subtotal.toString(),
    discountAmount: version.discountAmount.toString(),
    totalAmount: version.totalAmount.toString(),
    tradeTerm: version.tradeTerm,
    paymentTerm: version.paymentTerm,
    leadTimeDays: version.leadTimeDays,
    remark: version.remark,
  };
}

type DocumentAsset = NonNullable<Awaited<ReturnType<typeof findDocumentAsset>>>;

function assertDocumentAssetMetadata(asset: DocumentAsset, quotationId: string, versionId: string) {
  if (!validQuotationDocumentSha256(asset.contentSha256)) {
    throw codedError("形式发票缺少完整性摘要，请重新生成", 409, "QUOTATION_DOCUMENT_HASH_REQUIRED");
  }
  const expectedKey = quotationDocumentStorageKey(quotationId, versionId, asset.contentSha256, asset.fileName);
  if (asset.storageKey !== expectedKey || asset.mimeType !== MIME_TYPE) {
    throw codedError("形式发票存储元数据校验失败", 409, "QUOTATION_DOCUMENT_METADATA_MISMATCH");
  }
  if (!Number.isSafeInteger(asset.fileSize) || Number(asset.fileSize) < 5 || Number(asset.fileSize) > QUOTATION_DOCUMENT_MAX_BYTES) {
    throw codedError("形式发票存储大小元数据异常", 409, "QUOTATION_DOCUMENT_SIZE_METADATA_INVALID");
  }
}

function assetMetadata(asset: DocumentAsset) {
  return {
    id: asset.id,
    quotationVersionId: asset.sourceId,
    fileName: asset.fileName,
    mimeType: MIME_TYPE,
    fileSize: asset.fileSize,
    contentSha256: asset.contentSha256,
    uploadedAt: asset.uploadedAt,
  };
}

async function findDocumentAsset(versionId: string, client: QuotationClient = prisma) {
  return client.fileAsset.findUnique({
    where: { sourceTable_sourceId_fileRole: { sourceTable: SOURCE_TABLE, sourceId: versionId, fileRole: FILE_ROLE } },
  });
}

async function readVerifiedAsset(asset: DocumentAsset, quotationId: string, versionId: string) {
  assertDocumentAssetMetadata(asset, quotationId, versionId);
  const body = await readQuotationDocumentObject(asset.bucket, asset.storageKey, {
    maxBytes: QUOTATION_DOCUMENT_MAX_BYTES,
  });
  assertQuotationDocumentBody(body, asset.contentSha256 || "", asset.fileSize);
  return body;
}

export async function ensureQuotationDocument(
  request: AuditRequest,
  actor: QuotationActor,
  quotationId: string,
  input: unknown = {},
) {
  assertWrite(actor, "quotations");
  const actorId = String(actor?.id || "").trim();
  if (!actorId) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  const body = assertJsonObject(input);
  return prisma.$transaction(async (tx) => {
    await lockQuotationForEmailMutation(tx, quotationId);
    const quotation = await loadQuotation(quotationId, actor, tx);
    const version = quotationVersion(quotation, body.versionNumber);
    const existing = await findDocumentAsset(version.id, tx);
    if (existing?.contentSha256) {
      try {
        await readVerifiedAsset(existing, quotation.id, version.id);
      } catch (error) {
        if (existing.isDeleted && (error as { code?: string } | null)?.code === "R2_OBJECT_NOT_FOUND") {
          throw codedError("已软删除的形式发票原文件不存在，请联系管理员处理", 409, "QUOTATION_DOCUMENT_DELETED_OBJECT_MISSING");
        }
        throw error;
      }
      if (!existing.isDeleted && !existing.deletedAt) return assetMetadata(existing);
      const restored = await tx.fileAsset.update({
        where: { id: existing.id },
        data: { isDeleted: false, deletedAt: null },
      });
      await writeAudit(request, { id: actorId }, "恢复形式发票", SOURCE_TABLE, version.id, existing, restored, tx);
      return assetMetadata(restored);
    }

    assertQuotationPdfTemplateCanRender(version.documentTemplateVersion);
    assertQuotationCurrencyBankAccountSnapshot(version);
    const rendered = renderQuotationProformaInvoicePdf(quotationPdfSnapshot(quotation, version));
    const contentSha256 = assertQuotationDocumentBody(rendered.buffer);
    const fileName = safeFileName(rendered.fileName);
    const storageKey = quotationDocumentStorageKey(quotation.id, version.id, contentSha256, fileName);
    const stored = await storeQuotationDocumentObject({
      key: storageKey,
      body: rendered.buffer,
      contentType: MIME_TYPE,
      maxBytes: QUOTATION_DOCUMENT_MAX_BYTES,
      expectedSha256: contentSha256,
    });
    const uploadedAt = new Date();
    const asset = await tx.fileAsset.upsert({
      where: { sourceTable_sourceId_fileRole: { sourceTable: SOURCE_TABLE, sourceId: version.id, fileRole: FILE_ROLE } },
      create: {
        fileName, originalFileName: fileName, mimeType: MIME_TYPE,
        fileSize: rendered.buffer.byteLength, contentSha256, storageKey: stored.key,
        bucket: stored.bucket, uploadedAt, uploadedById: actorId,
        bindingType: "QUOTATION_DOCUMENT", sourceTable: SOURCE_TABLE,
        sourceId: version.id, fileRole: FILE_ROLE, relatedModule: "QUOTATIONS",
      },
      update: {
        fileName, originalFileName: fileName, mimeType: MIME_TYPE,
        fileSize: rendered.buffer.byteLength, contentSha256, storageKey: stored.key,
        bucket: stored.bucket, uploadedAt, uploadedById: actorId,
        isDeleted: false, deletedAt: null,
      },
    });
    await writeAudit(request, { id: actorId }, "生成形式发票", SOURCE_TABLE, version.id, existing, asset, tx);
    return assetMetadata(asset);
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function readQuotationDocument(actor: QuotationActor, quotationId: string, versionNumberValue: unknown) {
  assertRead(actor, "quotations");
  const quotation = await loadQuotation(quotationId, actor, prisma);
  const version = quotationVersion(quotation, versionNumberValue);
  const asset = await findDocumentAsset(version.id);
  if (!asset || asset.isDeleted || asset.deletedAt) {
    throw codedError("该版本尚未生成形式发票", 404, "QUOTATION_DOCUMENT_NOT_FOUND");
  }
  const body = await readVerifiedAsset(asset, quotation.id, version.id);
  return { body, asset, metadata: assetMetadata(asset) };
}
