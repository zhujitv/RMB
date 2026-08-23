import {
  codedError,
  isManagedPreviewableMimeType,
  managedPreviewableMimeType,
  normalizeManagedFileKind,
  MANAGED_FILE_KINDS,
  type ManagedFileBinding,
} from "./shared";
import {
  getOrderDocumentDownload,
  getOrderDocumentFileMetadata,
  getOrderDocumentPreview,
  getOrderDocumentPreviewLocation,
  getOrderDocumentPreviewMetadata,
} from "./order-documents";
import {
  getProductSupplierCostPaymentVoucher,
  getProductSupplierCostPaymentVoucherMetadata,
} from "./cost-records-mutations";
import {
  getSupplierDocumentRequestTemplate,
  getSupplierDocumentRequestTemplateMetadata,
} from "./supplier-document-requests";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type AuditRequestLike = {
  headers?: {
    get(name: string): string | null;
  };
} | null | undefined;
type ManagedFileBodyResult = {
  body: Buffer;
  mimeType: string;
  fileName: string;
  metadata: {
    id: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    uploadedAt: unknown;
    uploadedBy: unknown;
    binding: ManagedFileBinding;
    previewKind: string;
  };
};
type SerializedDocumentLike = {
  id?: string | null;
  orderId?: string | null;
  costId?: string | null;
  supplierId?: string | null;
  factoryDocumentRequestId?: string | null;
  documentType?: string | null;
  relatedModule?: string | null;
  fileName?: string | null;
  displayFileName?: string | null;
  downloadFileName?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  fileUrl?: string | null;
  uploadedAt?: unknown;
  uploadedBy?: unknown;
};
type SupplierTemplateLike = {
  body: Buffer;
  mimeType: string;
  fileName: string;
};

function managedOrderDocumentFileName(document: SerializedDocumentLike = {}) {
  return document.downloadFileName
    || document.displayFileName
    || document.fileName
    || document.originalFilename
    || document.originalName
    || "document.pdf";
}

function orderDocumentMetadata(document: SerializedDocumentLike = {}) {
  const mimeType = String(document.mimeType || "application/pdf");
  return {
    id: String(document.id || ""),
    fileUrl: String(document.fileUrl || ""),
    fileName: managedOrderDocumentFileName(document),
    mimeType,
    uploadedAt: document.uploadedAt || null,
    uploadedBy: document.uploadedBy || null,
    binding: {
      orderId: document.orderId || null,
      costId: document.costId || null,
      supplierDocumentRequestId: document.factoryDocumentRequestId || null,
      taxRefundDocumentType: document.documentType || null,
      orderDocumentId: document.id || null,
      relatedModule: document.relatedModule || null,
    },
    previewKind: managedPreviewableMimeType(mimeType),
  };
}

function supplierTemplateMetadata(requestId: string, template: SupplierTemplateLike) {
  const mimeType = String(template.mimeType || "application/octet-stream");
  return {
    id: requestId,
    fileUrl: "",
    fileName: template.fileName || "factory-document-template.xlsx",
    mimeType,
    uploadedAt: null,
    uploadedBy: null,
    binding: {
      supplierDocumentRequestId: requestId,
      relatedModule: "SUPPLIER_REQUEST_TEMPLATE",
    },
    previewKind: managedPreviewableMimeType(mimeType),
  };
}

function assertPreviewable(mimeType: string) {
  if (!isManagedPreviewableMimeType(mimeType)) {
    throw codedError("文件暂时无法预览，请下载查看。", 400, "INVALID_FILE_TYPE");
  }
}

export async function getManagedFileMetadata(request: AuditRequestLike, actor: ActorLike, kind: string, id: string) {
  const normalizedKind = normalizeManagedFileKind(kind);
  if (normalizedKind === MANAGED_FILE_KINDS.ORDER_DOCUMENT) {
    return getOrderDocumentFileMetadata(request, actor, id);
  }
  if (normalizedKind === MANAGED_FILE_KINDS.PAYMENT_VOUCHER) {
    const { metadata } = await getProductSupplierCostPaymentVoucherMetadata(request, actor, id);
    return metadata;
  }
  if (normalizedKind === MANAGED_FILE_KINDS.SUPPLIER_REQUEST_TEMPLATE) {
    return getSupplierDocumentRequestTemplateMetadata(request, actor, id);
  }
  throw codedError("不支持的文件类型。", 400, "INVALID_FILE_KIND");
}

export async function getManagedFileDownload(request: AuditRequestLike, actor: ActorLike, kind: string, id: string): Promise<ManagedFileBodyResult> {
  const normalizedKind = normalizeManagedFileKind(kind);
  if (normalizedKind === MANAGED_FILE_KINDS.ORDER_DOCUMENT) {
    const { body, mimeType, document } = await getOrderDocumentDownload(request, actor, id);
    return {
      body,
      mimeType: mimeType || "application/octet-stream",
      fileName: managedOrderDocumentFileName(document),
      metadata: orderDocumentMetadata(document),
    };
  }
  if (normalizedKind === MANAGED_FILE_KINDS.PAYMENT_VOUCHER) {
    const { body, mimeType, fileName, metadata } = await getProductSupplierCostPaymentVoucher(request, actor, id);
    return {
      body,
      mimeType: mimeType || "application/octet-stream",
      fileName,
      metadata,
    };
  }
  if (normalizedKind === MANAGED_FILE_KINDS.SUPPLIER_REQUEST_TEMPLATE) {
    const template = await getSupplierDocumentRequestTemplate(request, actor, id);
    return {
      body: template.body,
      mimeType: template.mimeType || "application/octet-stream",
      fileName: template.fileName,
      metadata: supplierTemplateMetadata(id, template),
    };
  }
  throw codedError("不支持的文件类型。", 400, "INVALID_FILE_KIND");
}

export async function getManagedFilePreview(request: AuditRequestLike, actor: ActorLike, kind: string, id: string): Promise<ManagedFileBodyResult> {
  const normalizedKind = normalizeManagedFileKind(kind);
  if (normalizedKind === MANAGED_FILE_KINDS.ORDER_DOCUMENT) {
    const { body, mimeType, document } = await getOrderDocumentPreview(request, actor, id);
    assertPreviewable(mimeType);
    return {
      body,
      mimeType,
      fileName: managedOrderDocumentFileName(document),
      metadata: orderDocumentMetadata(document),
    };
  }
  if (normalizedKind === MANAGED_FILE_KINDS.PAYMENT_VOUCHER) {
    const { body, mimeType, fileName, metadata } = await getProductSupplierCostPaymentVoucher(request, actor, id);
    assertPreviewable(mimeType);
    return {
      body,
      mimeType,
      fileName,
      metadata,
    };
  }
  const metadata = await getManagedFileMetadata(request, actor, kind, id);
  assertPreviewable(metadata.mimeType);
  throw codedError("文件暂时无法预览，请下载查看。", 400, "INVALID_FILE_TYPE");
}

export async function getManagedFilePreviewLocation(request: AuditRequestLike, actor: ActorLike, kind: string, id: string) {
  const normalizedKind = normalizeManagedFileKind(kind);
  if (normalizedKind !== MANAGED_FILE_KINDS.ORDER_DOCUMENT) return null;
  return getOrderDocumentPreviewLocation(request, actor, id);
}

export async function getManagedFilePreviewMetadata(request: AuditRequestLike, actor: ActorLike, kind: string, id: string) {
  const normalizedKind = normalizeManagedFileKind(kind);
  if (normalizedKind === MANAGED_FILE_KINDS.ORDER_DOCUMENT) {
    const document = await getOrderDocumentPreviewMetadata(request, actor, id);
    const metadata = orderDocumentMetadata(document);
    assertPreviewable(metadata.mimeType);
    return metadata;
  }
  const metadata = await getManagedFileMetadata(request, actor, kind, id);
  assertPreviewable(metadata.mimeType);
  return metadata;
}
