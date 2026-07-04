import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { orderAccessWhere } from "./order-access";
import { canRead } from "./shared-access";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  FACTORY_SUPPLIER_COST_TYPES,
  getCommissionFormulaSettings,
  includeOrderRelations,
  isProductSupplierOperatorRole,
  listShipsgoControlTowerTrackings,
  nonEmpty,
  needsTaxRefundCompletenessRefresh,
  cachedTaxRefundCompleteness,
  refreshTaxRefundCompletenessBatch,
  summarizeOrder,
  taxRefundStatusFromCompleteness,
  validCost,
} from "./shared";
import {
  LOGISTICS_INVOICE_DONE_STATUSES,
  LOGISTICS_PAYMENT_DONE_STATUSES,
  LOGISTICS_PAYMENT_READY_INVOICE_STATUSES,
  NEGATIVE_PROFIT_THRESHOLD,
  PROFIT_COST_REQUIRED_STATUSES,
  PROFIT_COST_REVIEW_STATUSES,
  PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE,
  TODO_LIMIT_PER_SOURCE,
  activeOrderBaseWhere,
  actorRole,
  actorSupplierId,
  isAdmin,
  isFinance,
  isFinanceOperator,
  isLogisticsOperator,
  isLogisticsSupplier,
  isPurchase,
  isSalesperson,
  logisticsBillAccessWhere,
  logisticsOwnerForOrder,
  orderHref,
  paidCostWhere,
  productSupplierPaymentCostWhere,
  roleOwner,
  salespersonOwner,
  supplierOwner,
  taxRefundArchiveOwner,
  todoForCost,
  todoForLogisticsBill,
  todoForOrder,
  todoForPayment,
  isProductSupplierPaymentCost,
  type ProfitOrder,
  type TodoCost,
  type TodoOrder,
  type WorkbenchTodo,
  type WorkbenchTodoContext,
} from "./workbench-todos-core";

export const LOGISTICS_STAGE_ORDER_STATUSES = ["已发货", "部分收款", "已收齐", "多收款"];
export const FINAL_TAX_REFUND_STATUSES = ["SUBMITTED", "REFUND_RECEIVED", "COMPLETED", "ARCHIVED"];

export type WorkbenchWorkflowOrder = TodoOrder & {
  customsDeclarationNo?: string | null;
  customsDeclarationDate?: Date | string | null;
  domesticLogisticsInfos?: Array<{ transportItems?: Array<{ containerNo?: string | null }> | null }> | null;
  logisticsExpenses?: Array<{ id?: string | null }> | null;
  costs?: Array<{
    id?: string | null;
    supplierId?: string | null;
    sourceType?: string | null;
    costType?: string | null;
    deletedAt?: Date | string | null;
    documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; costId?: string | null; supplierId?: string | null; deletedAt?: Date | string | null }> | null;
  }> | null;
  documents?: Array<{ documentType?: string | null; uploadStatus?: string | null; relatedModule?: string | null; costId?: string | null; supplierId?: string | null; deletedAt?: Date | string | null }> | null;
};
export type WorkbenchFactoryCostRef = {
  id?: string | null;
  supplierId?: string | null;
  sourceType?: string | null;
  costType?: string | null;
  deletedAt?: Date | string | null;
};

export function supplierDocumentFileMatchesCost(
  document: NonNullable<WorkbenchWorkflowOrder["documents"]>[number],
  cost: NonNullable<WorkbenchWorkflowOrder["costs"]>[number],
  documentType: string,
) {
  if (document.deletedAt || document.uploadStatus !== "SUCCESS") return false;
  if (document.relatedModule !== "SUPPLIER") return false;
  if (document.documentType !== documentType) return false;
  if (document.costId) return document.costId === cost.id;
  return Boolean(cost.supplierId && document.supplierId === cost.supplierId);
}

export function activeFactorySupplierCosts(order: WorkbenchWorkflowOrder) {
  return (order.costs || []).filter((cost) => (
    !cost.deletedAt
    && nonEmpty(cost.id)
    && cost.sourceType !== "LOGISTICS_EXPENSE"
    && FACTORY_SUPPLIER_COST_TYPES.includes(nonEmpty(cost.costType))
  ));
}

export function supplierDocumentRequestsForFactoryCosts(order: WorkbenchWorkflowOrder) {
  const costs = activeFactorySupplierCosts(order);
  return (order.supplierDocumentRequests || []).filter((request) => (
    !request.deletedAt
    && costs.some((cost) => supplierDocumentRequestMatchesCost(request, cost))
  ));
}

export function supplierDocumentsUploadedForFactoryCosts(order: WorkbenchWorkflowOrder) {
  const costs = activeFactorySupplierCosts(order);
  if (!costs.length) return false;
  const orderDocuments = order.documents || [];
  return costs.every((cost) => {
    const documents = [...orderDocuments, ...(cost.documents || [])];
    return ["SUPPLIER_PURCHASE_CONTRACT", "SUPPLIER_INVOICE"].every((documentType) => (
      documents.some((document) => supplierDocumentFileMatchesCost(document, cost, documentType))
    ));
  });
}

export function doneSupplierDocumentRequests(order: WorkbenchWorkflowOrder) {
  const requests = supplierDocumentRequestsForFactoryCosts(order);
  const requestsDone = requests.length > 0
    ? requests.every((request) => PRODUCT_SUPPLIER_DOCUMENT_STATUSES_DONE.includes(nonEmpty(request.status)))
    : true;
  return requestsDone && supplierDocumentsUploadedForFactoryCosts(order);
}

export function supplierDocumentRequestMatchesCost(
  request: NonNullable<TodoOrder["supplierDocumentRequests"]>[number],
  cost: { id?: string | null; supplierId?: string | null },
) {
  if (request.deletedAt) return false;
  if (request.costId) return request.costId === cost.id;
  return Boolean(cost.supplierId && request.supplierId === cost.supplierId);
}

export function isActiveFactorySupplierCostRef(cost: WorkbenchFactoryCostRef | null | undefined, supplierId = "") {
  if (!cost || cost.deletedAt) return false;
  if (cost.sourceType === "LOGISTICS_EXPENSE") return false;
  if (!FACTORY_SUPPLIER_COST_TYPES.includes(nonEmpty(cost.costType))) return false;
  return supplierId ? cost.supplierId === supplierId : Boolean(cost.supplierId);
}

export function supplierDocumentRequestHasFactoryCost(row: {
  supplierId?: string | null;
  costId?: string | null;
  cost?: WorkbenchFactoryCostRef | null;
  order?: { costs?: WorkbenchFactoryCostRef[] | null } | null;
}) {
  const supplierId = nonEmpty(row.supplierId);
  if (nonEmpty(row.costId)) return isActiveFactorySupplierCostRef(row.cost, supplierId);
  if (isActiveFactorySupplierCostRef(row.cost, supplierId)) return true;
  return (row.order?.costs || []).some((cost) => isActiveFactorySupplierCostRef(cost, supplierId));
}

export function logisticsSupplierAssigned(order: WorkbenchWorkflowOrder) {
  return (order.logisticsSuppliers || []).some((row) => nonEmpty(row?.supplierId) || nonEmpty(row?.supplier?.id));
}

export function domesticLogisticsInfoExists(order: WorkbenchWorkflowOrder) {
  return Boolean((order.domesticLogisticsInfos || []).length);
}

export function billOfLadingExists(order: WorkbenchWorkflowOrder) {
  return Boolean(
    nonEmpty(order.blNo)
    || (order as WorkbenchWorkflowOrder & { logisticsBills?: Array<{ billOfLadingNo?: string | null }> | null }).logisticsBills?.some((bill) => nonEmpty(bill.billOfLadingNo))
  );
}

export function orderEnteredLogisticsStage(order: WorkbenchWorkflowOrder) {
  return LOGISTICS_STAGE_ORDER_STATUSES.includes(nonEmpty(order.status))
    || Boolean(order.actualShipmentDate || order.blDate)
    || domesticLogisticsInfoExists(order)
    || billOfLadingExists(order);
}

export function transportInfoExists(order: WorkbenchWorkflowOrder) {
  return domesticLogisticsInfoExists(order) || billOfLadingExists(order);
}

export function customsDeclarationUploaded(order: WorkbenchWorkflowOrder) {
  return (order.documents || []).some((document) => (
    !document.deletedAt
    && document.documentType === "CUSTOMS_ENTRY_FORM"
    && document.uploadStatus === "SUCCESS"
    && document.relatedModule !== "SUPPLIER"
  ));
}

export function taxRefundFinalized(order: WorkbenchWorkflowOrder) {
  return Boolean(
    order.taxArchived
    || order.taxSubmittedAt
    || order.taxRefundArchivedAt
    || FINAL_TAX_REFUND_STATUSES.includes(nonEmpty(order.taxRefundStatus))
  );
}

export function logisticsBillReviewAccessWhere(actor: WorkbenchTodoContext["actor"]): Prisma.LogisticsBillWhereInput {
  if (isAdmin(actor) || isFinance(actor)) return {};
  if (isSalesperson(actor)) return logisticsBillAccessWhere(actor);
  return { id: "__no_logistics_bill_review_access__" };
}
