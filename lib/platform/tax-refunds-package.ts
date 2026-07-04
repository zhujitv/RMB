import JSZip from "jszip";
import { prisma } from "../prisma";
import { type OrderDocumentType } from "../generated/prisma/client.js";
import { readR2Object, safeFileName } from "../r2";
import {
  DOMESTIC_LOGISTICS_DOCUMENT_TYPES,
  ORDER_DOCUMENT_TYPES,
  SUPPLIER_DOCUMENT_TYPES,
  assertRead,
  permissionError,
  standardFilenameForDocument,
  writeAudit,
} from "./shared";
import { canReadDocumentContent } from "./order-documents";
import { orderAccessWhere } from "./order-access";
import {
  type ActorLike,
  type AuditRequestLike,
  type StandardFilenameOrder,
  type TaxRefundPackageDocument,
  type TaxRefundPackageOrder,
} from "./tax-refunds-shared";

function taxPackageName(order: TaxRefundPackageOrder) {
  return `退税资料_${safeFileName(order.orderNo || "订单")}_${safeFileName(order.blNo || "待发货")}_${safeFileName(order.customerNameSnapshot || order.customer?.name || "客户")}.zip`;
}

function supplierArchiveFileName(document: TaxRefundPackageDocument, _index: number, _total: number, order: StandardFilenameOrder = {}) {
  const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
  const isLogisticsInvoice = isTaxRefundLogisticsInvoiceDocument(document);
  const folder = isLogisticsInvoice ? "物流资料" : "供应商资料";
  return `${folder}/${safeFileName(supplierName)}/${standardFilenameForDocument(document, order)}`;
}

function isTaxRefundLogisticsInvoiceDocument(document: TaxRefundPackageDocument) {
  return document?.relatedModule === "SUPPLIER" && document?.documentType && /_INVOICE$/.test(document.documentType);
}

function isTaxRefundSupplierDocument(document: TaxRefundPackageDocument) {
  return document?.relatedModule === "SUPPLIER";
}

export async function buildTaxRefundPackage(request: AuditRequestLike, actor: ActorLike, orderId: string, documentType = "") {
  assertRead(actor, "taxRefund");
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, deletedAt: null, ...orderAccessWhere(actor) },
    include: {
      customer: true,
      businessEntity: true,
      documents: {
        where: { deletedAt: null, uploadStatus: "SUCCESS" },
        include: { uploadedBy: true, cost: { include: { supplier: true } }, supplier: true },
      },
    },
  });
  if (!order) throw permissionError("应收订单不存在或已删除", 404);
  const selectedTypes: OrderDocumentType[] = ORDER_DOCUMENT_TYPES.includes(documentType as OrderDocumentType)
    ? [documentType as OrderDocumentType]
    : ORDER_DOCUMENT_TYPES;
  const documents = order.documents
    .filter((document) => (
      selectedTypes.includes(document.documentType)
      && (!SUPPLIER_DOCUMENT_TYPES.includes(document.documentType) || isTaxRefundSupplierDocument(document))
      && canReadDocumentContent(actor, { ...document, order })
    ))
    .sort((a, b) => ORDER_DOCUMENT_TYPES.indexOf(a.documentType) - ORDER_DOCUMENT_TYPES.indexOf(b.documentType) || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  if (!documents.length) throw permissionError("没有可下载的 PDF 单证", 404);
  const zip = new JSZip();
  for (const type of selectedTypes) {
    const typeDocs = documents.filter((document) => document.documentType === type);
    if (SUPPLIER_DOCUMENT_TYPES.includes(type)) {
      const groups: (typeof typeDocs)[] = Object.values(typeDocs.reduce<Record<string, typeof typeDocs>>((acc, document) => {
        const supplierName = document.supplier?.supplierName || document.cost?.supplierNameSnapshot || document.cost?.supplier?.supplierName || "未命名供应商";
        acc[supplierName] ||= [];
        acc[supplierName].push(document);
        return acc;
      }, {}));
      for (const group of groups) {
        for (let index = 0; index < group.length; index += 1) {
          const document = group[index];
          zip.file(supplierArchiveFileName(document, index, group.length, order), await readR2Object(document.storageKey));
        }
      }
    } else {
      const folder = DOMESTIC_LOGISTICS_DOCUMENT_TYPES.includes(type) ? "报关资料" : "出口资料";
      for (let index = 0; index < typeDocs.length; index += 1) {
        const document = typeDocs[index];
        zip.file(`${folder}/${standardFilenameForDocument(document, order)}`, await readR2Object(document.storageKey));
      }
    }
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  await writeAudit(request, actor, documentType ? "下载单证分类ZIP" : "下载ZIP", "receivable_orders", order.id, null, {
    orderNo: order.orderNo,
    documentType: documentType || "ALL",
    fileCount: documents.length,
  }).catch(() => null);
  return { buffer, fileName: taxPackageName(order) };
}
