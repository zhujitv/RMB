import { summarizeWorkbenchTodos } from "./workbench-todo-rules";
import type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
import { SUPPLIER_DOCUMENT_TYPES } from "./shared";
import { completedTodayTodos } from "./workbench-todos-completed";
import { createWorkbenchTodoContext, sortWorkbenchTodos, uniqueTodos, type ActorLike } from "./workbench-todos-core";
import {
  listCustomerPaymentTodos,
  listDomesticLogisticsTodos,
  listFactoryPaymentTodos,
  listLogisticsFeeTodos,
  listOceanTrackingTodos,
  listOrderTodos,
  listProfitTodos,
  listSupplierDocumentTodos,
  listTaxRefundTodos,
} from "./workbench-todos-sources";

export type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
export type { WorkbenchTodo, WorkbenchTodoOwnerRole, WorkbenchTodoStatus } from "./workbench-todos-core";

export async function listWorkbenchTodos(actor: ActorLike) {
  const context = await createWorkbenchTodoContext(actor);
  const [
    orderTodos,
    domesticLogisticsTodos,
    logisticsFeeTodos,
    supplierDocumentTodos,
    customerPaymentTodos,
    factoryPaymentTodos,
    taxRefundTodos,
    profitTodos,
    oceanTrackingTodos,
    completedTodos,
  ] = await Promise.all([
    listOrderTodos(context),
    listDomesticLogisticsTodos(context),
    listLogisticsFeeTodos(context),
    listSupplierDocumentTodos(context),
    listCustomerPaymentTodos(context),
    listFactoryPaymentTodos(context),
    listTaxRefundTodos(context),
    listProfitTodos(context),
    listOceanTrackingTodos(context),
    completedTodayTodos(context),
  ]);
  const todos = uniqueTodos([
    ...orderTodos,
    ...domesticLogisticsTodos,
    ...logisticsFeeTodos,
    ...supplierDocumentTodos,
    ...customerPaymentTodos,
    ...factoryPaymentTodos,
    ...taxRefundTodos,
    ...profitTodos,
    ...oceanTrackingTodos,
  ]).sort(sortWorkbenchTodos);
  return {
    todos,
    completedTodos,
    summary: summarizeWorkbenchTodos(todos, completedTodos.length),
    generatedAt: new Date().toISOString(),
    sourceTypes: [
      "orders",
      "domesticLogistics",
      "logisticsFees",
      "supplierDocuments",
      "payments",
      "factoryPayments",
      "taxRefund",
      "profit",
      "oceanTracking",
    ],
    supportedDocumentTypes: SUPPLIER_DOCUMENT_TYPES,
  };
}
