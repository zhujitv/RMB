import { canActivateTodo, summarizeWorkbenchTodos } from "./workbench-todo-rules";
import type { WorkbenchTodoPriority, WorkbenchTodoSummary } from "./workbench-todo-rules";
import { SUPPLIER_DOCUMENT_TYPES } from "./shared";
import { completedTodayTodos } from "./workbench-todos-completed";
import { createWorkbenchTodoContext, sortWorkbenchTodos, uniqueTodos, type ActorLike } from "./workbench-todos-core";
import { WORKBENCH_TODOS_CACHE_MS, invalidateWorkbenchTodosCache, workbenchTodosCache, workbenchTodosCacheKey } from "./workbench-todos-cache";
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

type WorkbenchTodosResult = {
  todos: ReturnType<typeof uniqueTodos>;
  completedTodos: Awaited<ReturnType<typeof completedTodayTodos>>;
  summary: WorkbenchTodoSummary;
  generatedAt: string;
  sourceTypes: string[];
  supportedDocumentTypes: typeof SUPPLIER_DOCUMENT_TYPES;
};

export { invalidateWorkbenchTodosCache };

async function buildWorkbenchTodos(actor: ActorLike): Promise<WorkbenchTodosResult> {
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
  const generatedTodos = uniqueTodos([
    ...orderTodos,
    ...domesticLogisticsTodos,
    ...logisticsFeeTodos,
    ...supplierDocumentTodos,
    ...customerPaymentTodos,
    ...factoryPaymentTodos,
    ...taxRefundTodos,
    ...profitTodos,
    ...oceanTrackingTodos,
  ]);
  const todos = generatedTodos
    .filter(canActivateTodo)
    .sort(sortWorkbenchTodos);
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

export async function listWorkbenchTodos(actor: ActorLike, options: { bypassCache?: boolean } = {}) {
  const cacheKey = workbenchTodosCacheKey(actor);
  const cache = workbenchTodosCache();
  const cached = cache.get(cacheKey);
  if (!options.bypassCache && WORKBENCH_TODOS_CACHE_MS > 0 && cached && cached.expiresAt > Date.now()) return cached.value as WorkbenchTodosResult;
  const value = await buildWorkbenchTodos(actor);
  if (WORKBENCH_TODOS_CACHE_MS > 0) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + WORKBENCH_TODOS_CACHE_MS,
      value,
    });
  }
  return value;
}
