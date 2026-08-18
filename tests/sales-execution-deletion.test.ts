import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("lib/platform/sales-execution-deletion.ts", "utf8");
const route = readFileSync("app/api/sales-executions/[id]/permanent/route.ts", "utf8");
const migration = readFileSync(
  "prisma/migrations/20260818220000_voided_sales_execution_hard_delete/migration.sql",
  "utf8",
);
const moduleSource = readFileSync("app/modules/SalesExecutionModule.tsx", "utf8");
const moduleView = readFileSync("app/modules/sales-execution/sales-execution-module-view.tsx", "utf8");
const detail = readFileSync("app/modules/sales-execution/execution-detail-drawer.tsx", "utf8");
const hook = readFileSync("app/modules/sales-execution/use-sales-execution-deletion.ts", "utf8");

test("销售执行永久删除使用独立路由且保留原 DELETE 作废语义", () => {
  assert.match(route, /export async function DELETE[\s\S]*deleteVoidedSalesExecution/);
  assert.match(route, /parseJsonBody\(request\)/);
  assert.match(route, /销售执行及关联采购数据已永久删除/);
  assert.match(hook, /\/api\/sales-executions\/\$\{encodeURIComponent\(execution\.id\)\}\/permanent/);
  assert.match(hook, /method: "DELETE"/);
});

test("永久删除仅限管理员和已作废状态并执行作用域、版本与订单号复核", () => {
  assert.match(service, /actor\?\.role !== "管理员"/);
  assert.match(service, /assertWrite\(actor, "salesExecution"\)/);
  assert.match(service, /salesExecutionAccessWhere\(actor\)/);
  assert.match(service, /assertCustomerScope\(actor, before\.customerId, tx\)/);
  assert.match(service, /assertExpectedSalesExecutionRevision\(body, before\.revision\)/);
  assert.match(service, /before\.status !== "VOIDED"/);
  assert.match(service, /confirmCustomerOrderNo !== before\.customerOrderNo/);
  assert.match(service, /SALES_EXECUTION_DELETE_RECEIVABLE_LINKED/);
});

test("永久删除先记录审计并清理全部执行子链与附件", () => {
  assert.match(service, /writeAudit[\s\S]*永久删除已作废销售执行/);
  assert.match(service, /enqueueFileStorageDeletion/);
  assert.match(service, /factoryPurchaseOrderLoadingResultItem\.deleteMany[\s\S]*factoryPurchaseOrderLoadingResult\.deleteMany/);
  assert.match(service, /factoryPurchaseOrderProductionReportItem\.deleteMany[\s\S]*factoryPurchaseOrderProductionReport\.deleteMany/);
  assert.match(service, /factoryPurchaseOrderDeliveryQuantityVarianceItem\.deleteMany[\s\S]*factoryPurchaseOrderDeliveryQuantityVariance\.deleteMany/);
  assert.match(service, /factoryPurchaseOrderSupplierPrice\.deleteMany[\s\S]*factoryPurchaseOrderSupplierResponse\.deleteMany/);
  assert.match(service, /factoryPurchaseOrderItem\.deleteMany[\s\S]*factoryPurchaseOrder\.deleteMany/);
  assert.match(service, /salesExecutionItem\.deleteMany[\s\S]*salesExecutionVersion\.deleteMany[\s\S]*salesExecution\.deleteMany/);
});

test("数据库硬删除通道由事务局部执行单 ID 和 VOIDED 状态双重约束", () => {
  assert.match(migration, /current_setting\('app\.sales_execution_hard_delete_id', TRUE\)/);
  assert.match(migration, /resolved_execution_id IS DISTINCT FROM requested_execution_id/);
  assert.match(migration, /"status" = 'VOIDED'/);
  assert.match(migration, /NOT trigger\.tgisinternal/);
  assert.match(migration, /\(trigger\.tgtype & 8\) = 8/);
  assert.match(migration, /sales_execution_hard_delete_allowed"\(TG_TABLE_NAME, TO_JSONB\(OLD\)\)/);
  assert.match(service, /set_config\('app\.sales_execution_hard_delete_id', \$\{before\.id\}, true\)/);
});

test("只有管理员在已作废详情看到永久删除并需输入客户订单号", () => {
  assert.match(moduleSource, /const canDelete = currentUser\.role === "管理员" && canWrite/);
  assert.match(moduleView, /canDelete=\{canDelete && detailExecution\.status === "VOIDED"/);
  assert.match(detail, /canDelete \? <button[\s\S]*永久删除/);
  assert.match(hook, /inputExpectedValue: customerOrderNo/);
  assert.match(hook, /该操作不可撤销/);
});
