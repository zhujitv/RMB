import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { prisma } from "../prisma";
import { readR2Object, safeFileName, uploadToR2 } from "../r2";
import { assertRead, assertWrite } from "./shared-access";
import { codedError, logServerError, nonEmpty } from "./shared-base-utils";
import { deleteManagedStoredFile } from "./file-center";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";
import { serializeBusinessEntitySettings } from "./business-entity-core";
import {
  locateSupplierContractSealAnchor,
} from "./supplier-contract-seal-position";
import { supplierContractSealPlacement } from "./supplier-contract-seal-position-math";
import { writeAudit } from "./shared-audit";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ElectronicSealUploadFile = {
  originalFileName: string;
  mimeType: string;
  body: Buffer;
  fileSize: number;
};

export const BUSINESS_ENTITY_ELECTRONIC_SEAL_MAX_BYTES = 2 * 1024 * 1024;
export const BUSINESS_ENTITY_ELECTRONIC_SEAL_ACCEPT = "image/png,.png";

function assertPngSignature(body: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (body.byteLength < signature.byteLength || !body.subarray(0, signature.byteLength).equals(signature)) {
    throw codedError("电子章仅支持透明背景 PNG 图片。", 400, "BUSINESS_ENTITY_SEAL_INVALID_PNG");
  }
}

async function readElectronicSealUploadFile(candidate: unknown): Promise<ElectronicSealUploadFile> {
  const file = candidate as File | null;
  if (!file || typeof file.arrayBuffer !== "function") {
    throw codedError("请选择透明背景 PNG 电子章。", 400, "BUSINESS_ENTITY_SEAL_FILE_REQUIRED");
  }
  const originalFileName = safeFileName(file.name || "electronic-seal.png");
  const mimeType = String(file.type || "image/png").toLowerCase();
  if (!originalFileName.toLowerCase().endsWith(".png") || mimeType !== "image/png") {
    throw codedError("电子章仅支持透明背景 PNG 图片。", 400, "BUSINESS_ENTITY_SEAL_TYPE_INVALID");
  }
  const body = Buffer.from(await file.arrayBuffer());
  if (!body.byteLength) throw codedError("电子章文件为空。", 400, "BUSINESS_ENTITY_SEAL_EMPTY");
  if (body.byteLength > BUSINESS_ENTITY_ELECTRONIC_SEAL_MAX_BYTES) {
    throw codedError("电子章图片不能超过 2MB。", 400, "BUSINESS_ENTITY_SEAL_TOO_LARGE");
  }
  assertPngSignature(body);
  return { originalFileName, mimeType, body, fileSize: body.byteLength };
}

export function businessEntityElectronicSealStorageKey(entityId: string, fileName = "electronic-seal.png") {
  const safeEntityId = nonEmpty(entityId).replace(/[^A-Za-z0-9_-]+/g, "-") || "unknown-entity";
  const safeName = safeFileName(fileName || "electronic-seal.png");
  return `business-entities/${safeEntityId}/electronic-seal/${Date.now()}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
}

export async function findBusinessEntityElectronicSealAsset(businessEntityId: string) {
  if (!businessEntityId) return null;
  return prisma.fileAsset.findFirst({
    where: {
      sourceTable: FILE_ASSET_SOURCE_TABLES.BUSINESS_ENTITIES,
      sourceId: businessEntityId,
      fileRole: FILE_ASSET_ROLES.BUSINESS_ENTITY_ELECTRONIC_SEAL,
      isDeleted: false,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export function serializeBusinessEntityElectronicSeal(asset: Awaited<ReturnType<typeof findBusinessEntityElectronicSealAsset>>) {
  if (!asset) return null;
  return {
    fileName: asset.fileName || "电子章.png",
    mimeType: asset.mimeType || "image/png",
    fileSize: asset.fileSize || 0,
    uploadedAt: asset.uploadedAt || asset.updatedAt || null,
  };
}

export async function serializeBusinessEntitySettingsWithSeal(entity: Parameters<typeof serializeBusinessEntitySettings>[0]) {
  const seal = entity?.id ? await findBusinessEntityElectronicSealAsset(entity.id) : null;
  return serializeBusinessEntitySettings(entity, serializeBusinessEntityElectronicSeal(seal));
}

export async function serializeBusinessEntitySettingsRowsWithSeals<T extends Parameters<typeof serializeBusinessEntitySettings>[0] & { id?: string | null }>(rows: T[]) {
  const seals = await prisma.fileAsset.findMany({
    where: {
      sourceTable: FILE_ASSET_SOURCE_TABLES.BUSINESS_ENTITIES,
      sourceId: { in: rows.map((row) => row?.id || "").filter(Boolean) },
      fileRole: FILE_ASSET_ROLES.BUSINESS_ENTITY_ELECTRONIC_SEAL,
      isDeleted: false,
      deletedAt: null,
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const sealByEntityId = new Map<string, (typeof seals)[number]>();
  for (const seal of seals) {
    if (!sealByEntityId.has(seal.sourceId)) sealByEntityId.set(seal.sourceId, seal);
  }
  return rows.map((row) => serializeBusinessEntitySettings(row, serializeBusinessEntityElectronicSeal(sealByEntityId.get(row?.id || "") || null)));
}

export async function uploadBusinessEntityElectronicSeal(
  request: AuditRequestLike,
  actor: ActorLike,
  businessEntityId: string,
  fileInput: unknown,
) {
  assertWrite(actor, "settings");
  const entity = await prisma.businessEntity.findFirst({
    where: { id: businessEntityId, deletedAt: null },
    include: { bankAccounts: { orderBy: { currency: "asc" } } },
  });
  if (!entity) throw codedError("业务主体不存在或已删除。", 404, "BUSINESS_ENTITY_NOT_FOUND");
  const file = await readElectronicSealUploadFile(fileInput);
  const previous = await findBusinessEntityElectronicSealAsset(entity.id);
  const storageKey = businessEntityElectronicSealStorageKey(entity.id, file.originalFileName);
  const stored = await uploadToR2({ key: storageKey, body: file.body, contentType: file.mimeType });
  let savedEntity = entity;
  try {
    savedEntity = await prisma.$transaction(async (tx) => {
      await tx.fileAsset.upsert({
        where: {
          sourceTable_sourceId_fileRole: {
            sourceTable: FILE_ASSET_SOURCE_TABLES.BUSINESS_ENTITIES,
            sourceId: entity.id,
            fileRole: FILE_ASSET_ROLES.BUSINESS_ENTITY_ELECTRONIC_SEAL,
          },
        },
        create: {
          fileName: file.originalFileName,
          originalFileName: file.originalFileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          storageKey: stored.key,
          bucket: stored.bucket,
          uploadedAt: new Date(),
          uploadedById: actor?.id || null,
          bindingType: "BUSINESS_ENTITY_SEAL",
          sourceTable: FILE_ASSET_SOURCE_TABLES.BUSINESS_ENTITIES,
          sourceId: entity.id,
          fileRole: FILE_ASSET_ROLES.BUSINESS_ENTITY_ELECTRONIC_SEAL,
          relatedModule: "BUSINESS_ENTITY",
          isDeleted: false,
          deletedAt: null,
        },
        update: {
          fileName: file.originalFileName,
          originalFileName: file.originalFileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          storageKey: stored.key,
          bucket: stored.bucket,
          uploadedAt: new Date(),
          uploadedById: actor?.id || null,
          bindingType: "BUSINESS_ENTITY_SEAL",
          relatedModule: "BUSINESS_ENTITY",
          isDeleted: false,
          deletedAt: null,
        },
      });
      const refreshed = await tx.businessEntity.findUnique({
        where: { id: entity.id },
        include: { bankAccounts: { orderBy: { currency: "asc" } } },
      });
      if (!refreshed) throw codedError("业务主体不存在或已删除。", 404, "BUSINESS_ENTITY_NOT_FOUND");
      return refreshed;
    });
  } catch (error) {
    await deleteManagedStoredFile(stored.key).catch(() => null);
    throw error;
  }
  if (previous?.storageKey && previous.storageKey !== stored.key) {
    deleteManagedStoredFile(previous.storageKey).catch((error) => {
      logServerError("业务主体旧电子章删除失败", error, { businessEntityId: entity.id });
    });
  }
  writeAudit(request, actor, "上传业务主体电子章", "business_entities", entity.id, null, {
    businessEntityName: entity.name,
    fileName: file.originalFileName,
  }).catch((error) => logServerError("上传业务主体电子章日志写入失败", error, { businessEntityId: entity.id }));
  return {
    entity: await serializeBusinessEntitySettingsWithSeal(savedEntity),
  };
}

function businessEntityAuditSeal(asset: Awaited<ReturnType<typeof findBusinessEntityElectronicSealAsset>>) {
  if (!asset) return null;
  return {
    fileName: asset.fileName,
    storageKey: asset.storageKey,
    uploadedAt: asset.uploadedAt,
  };
}

export async function deleteBusinessEntityElectronicSeal(request: AuditRequestLike, actor: ActorLike, businessEntityId: string) {
  assertWrite(actor, "settings");
  const entity = await prisma.businessEntity.findFirst({
    where: { id: businessEntityId, deletedAt: null },
    include: { bankAccounts: { orderBy: { currency: "asc" } } },
  });
  if (!entity) throw codedError("业务主体不存在或已删除。", 404, "BUSINESS_ENTITY_NOT_FOUND");
  const previous = await findBusinessEntityElectronicSealAsset(entity.id);
  if (previous) {
    await prisma.fileAsset.updateMany({
      where: {
        sourceTable: FILE_ASSET_SOURCE_TABLES.BUSINESS_ENTITIES,
        sourceId: entity.id,
        fileRole: FILE_ASSET_ROLES.BUSINESS_ENTITY_ELECTRONIC_SEAL,
        isDeleted: false,
      },
      data: { isDeleted: true, deletedAt: new Date() },
    });
    deleteManagedStoredFile(previous.storageKey).catch((error) => {
      logServerError("业务主体电子章文件删除失败", error, { businessEntityId: entity.id });
    });
  }
  writeAudit(request, actor, "删除业务主体电子章", "business_entities", entity.id, businessEntityAuditSeal(previous), null)
    .catch((error) => logServerError("删除业务主体电子章日志写入失败", error, { businessEntityId: entity.id }));
  return { entity: serializeBusinessEntitySettings(entity, null) };
}

export async function readBusinessEntityElectronicSealImage(actor: ActorLike, businessEntityId: string) {
  assertRead(actor, "settings");
  const asset = await findBusinessEntityElectronicSealAsset(businessEntityId);
  if (!asset) throw codedError("该业务主体尚未上传电子章。", 404, "BUSINESS_ENTITY_SEAL_NOT_FOUND");
  const body = await readR2Object(asset.storageKey, { maxBytes: BUSINESS_ENTITY_ELECTRONIC_SEAL_MAX_BYTES });
  return {
    body,
    mimeType: asset.mimeType || "image/png",
    fileName: asset.fileName || "电子章.png",
  };
}

async function drawElectronicSealAtAnchor(
  pdf: PDFDocument,
  sealPngBody: Buffer,
  anchor: Parameters<typeof supplierContractSealPlacement>[0],
) {
  const pages = pdf.getPages();
  const pageSizes = pages.map((page) => ({ width: page.getWidth(), height: page.getHeight() }));
  const pageSize = pageSizes[anchor.pageIndex];
  if (!pageSize) throw codedError("合同盖章页不存在。", 400, "SUPPLIER_CONTRACT_SEAL_PAGE_INVALID");
  const optimizedSealPng = await sharp(sealPngBody)
    .rotate()
    .resize({ width: 450, height: 450, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 95 })
    .toBuffer();
  const seal = await pdf.embedPng(optimizedSealPng);
  const placement = supplierContractSealPlacement(anchor, pageSize, seal.height / Math.max(1, seal.width));
  const page = pages[placement.pageIndex];
  if (!page) throw codedError("合同盖章页不存在。", 400, "SUPPLIER_CONTRACT_SEAL_PAGE_INVALID");
  page.drawImage(seal, {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    opacity: 0.92,
  });
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

export async function stampPdfWithElectronicSealAtAnchor(
  pdfBody: Buffer,
  sealPngBody: Buffer,
  anchor: Parameters<typeof supplierContractSealPlacement>[0],
) {
  const pdf = await PDFDocument.load(pdfBody);
  const pages = pdf.getPages();
  if (!pages.length) throw codedError("合同 PDF 没有可盖章页面。", 400, "SUPPLIER_CONTRACT_PDF_EMPTY");
  return drawElectronicSealAtAnchor(pdf, sealPngBody, anchor);
}

export async function stampPdfWithElectronicSeal(pdfBody: Buffer, sealPngBody: Buffer) {
  const pdf = await PDFDocument.load(pdfBody);
  const pages = pdf.getPages();
  if (!pages.length) throw codedError("合同 PDF 没有可盖章页面。", 400, "SUPPLIER_CONTRACT_PDF_EMPTY");
  const pageSizes = pages.map((page) => ({ width: page.getWidth(), height: page.getHeight() }));
  const anchor = await locateSupplierContractSealAnchor(pdfBody, pageSizes);
  return drawElectronicSealAtAnchor(pdf, sealPngBody, anchor);
}

export async function stampSupplierPurchaseContractForBusinessEntity(businessEntityId: string, pdfBody: Buffer) {
  const sealAsset = await findBusinessEntityElectronicSealAsset(businessEntityId);
  if (!sealAsset) return { body: pdfBody, sealed: false };
  try {
    const sealBody = await readR2Object(sealAsset.storageKey, { maxBytes: BUSINESS_ENTITY_ELECTRONIC_SEAL_MAX_BYTES });
    assertPngSignature(sealBody);
    const body = await stampPdfWithElectronicSeal(pdfBody, sealBody);
    return { body, sealed: true, sealFileName: sealAsset.fileName || "电子章.png" };
  } catch (error) {
    logServerError("供应商合同自动盖章失败", error, { businessEntityId });
    if (["SUPPLIER_CONTRACT_SEAL_POSITION_NOT_FOUND", "SUPPLIER_CONTRACT_SEAL_OCR_UNAVAILABLE"].includes((error as { code?: string } | null)?.code || "")) throw error;
    throw codedError("业务主体电子章配置异常，无法生成已盖章合同；请管理员重新上传透明 PNG 电子章。", 409, "BUSINESS_ENTITY_SEAL_STAMP_FAILED");
  }
}
