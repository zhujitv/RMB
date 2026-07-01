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

type WorkbenchTodosResult = {
  todos: ReturnType<typeof uniqueTodos>;
  completedTodos: Awaited<ReturnType<typeof completedTodayTodos>>;
  summary: WorkbenchTodoSummary;
  generatedAt: string;
  sourceTypes: string[];
  supportedDocumentTypes: typeof SUPPLIER_DOCUMENT_TYPES;
};

type WorkbenchTodosCacheEntry = {
  expiresAt: number;
  value: WorkbenchTodosResult;
};

const WORKBENCH_TODOS_CACHE_MS = Math.max(0, Number(process.env.WORKBENCH_TODOS_CACHE_MS || 15000));

function workbenchTodosCache() {
  const store = globalThis as typeof globalThis & {
    __nextwoodWorkbenchTodosCache?: Map<string, WorkbenchTodosCacheEntry>;
  };
  store.__nextwoodWorkbenchTodosCache ||= new Map<string, WorkbenchTodosCacheEntry>();
  return store.__nextwoodWorkbenchTodosCache;
}

function workbenchTodosCacheKey(actor: ActorLike) {
  return [
    actor?.id || "",
    actor?.role || "",
    actor?.supplierId || "",
  ].join(":");
}

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

export async function listWorkbenchTodos(actor: ActorLike) {
  const cacheKey = workbenchTodosCacheKey(actor);
  const cache = workbenchTodosCache();
  const cached = cache.get(cacheKey);
  if (WORKBENCH_TODOS_CACHE_MS > 0 && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await buildWorkbenchTodos(actor);
  if (WORKBENCH_TODOS_CACHE_MS > 0) {
    cache.set(cacheKey, {
      expiresAt: Date.now() + WORKBENCH_TODOS_CACHE_MS,
      value,
    });
  }
  return value;
}
