import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readCostRecordsMutationsSource,
  readDomesticLogisticsApiSource,
  readLogisticsExpenseWorkflowSource,
  readOrderDocumentsSource,
  readOrdersServiceSource,
  readNotificationTemplatesSource,
  readPaymentsServiceSource,
  readSharedAuthSource,
  readSharedUsersSource,
  readShipsgoTrackingSource,
  readSupplierDocumentRequestsSource,
  readTaxRefundsSource,
} from "./source-helpers.ts";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertAudit(sourceText: string, action: string, entityType: string) {
  assert.match(sourceText, /\bwriteAudit\(/);
  assert.match(sourceText, new RegExp(escapeRegExp(action)));
  assert.match(sourceText, new RegExp(`["']${escapeRegExp(entityType)}["']`));
}

const sharedAudit = source("lib/platform/shared-audit.ts");
const sharedAuth = readSharedAuthSource();
const loginRoute = source("app/api/auth/login/route.ts");
const verifyEmailRoute = source("app/api/auth/verify-email/route.ts");
const sharedUsers = readSharedUsersSource();
const orders = readOrdersServiceSource();
const payments = readPaymentsServiceSource();
const costs = readCostRecordsMutationsSource();
const orderDocuments = readOrderDocumentsSource();
const taxRefunds = readTaxRefundsSource();
const domesticLogistics = readDomesticLogisticsApiSource();
const logisticsWorkflow = readLogisticsExpenseWorkflowSource();
const supplierDocuments = readSupplierDocumentRequestsSource();
const shipsgoTracking = readShipsgoTrackingSource();
const companyProfile = source("lib/platform/company-profile.ts");
const commissionFormula = source("lib/platform/commission-formula.ts");
const notificationTemplates = readNotificationTemplatesSource();
const securityAuditScript = source("scripts/security-audit.mjs");

test("auth lifecycle records sanitized audit events", () => {
  assert.match(sharedAudit, /export async function writeAuthAudit/);
  assert.match(sharedAudit, /"auth_events"/);
  assert.match(sharedAudit, /loginIdHash/);
  assert.match(loginRoute, /writeAuthAudit/);
  assert.match(loginRoute, /recordLoginAudit\(request, "登录失败", false, "wrong_password"/);
  assert.match(loginRoute, /recordLoginAudit\(request, "登录失败", false, "email_not_verified"/);
  assert.match(loginRoute, /recordLoginAudit\(request, "登录失败", false, "user_pending_approval"/);
  assert.match(loginRoute, /recordLoginAudit\(request, "登录成功", true/);
  assert.match(sharedUsers, /writeAuthAudit\(request, \{[\s\S]*action: "邮箱验证成功"/);
  assert.match(verifyEmailRoute, /verifyRegistrationEmail\(token, request\)/);
});

test("master data and account changes write audit logs", () => {
  assertAudit(sharedUsers, "用户自助注册", "users");
  assertAudit(sharedUsers, "新增用户", "users");
  assertAudit(sharedUsers, "更新用户", "users");
  assertAudit(sharedUsers, "更新用户状态", "users");
  assertAudit(sharedUsers, "修改本人资料", "users");
  assertAudit(sharedAuth, "修改本人密码", "users");
  assertAudit(source("lib/platform/customer-masters.ts"), "新增客户", "customers");
  assertAudit(source("lib/platform/customer-masters.ts"), "更新客户", "customers");
  assertAudit(source("lib/platform/customer-masters.ts"), "删除客户", "customers");
  assertAudit(source("lib/platform/supplier-masters.ts"), "新增供应商", "suppliers");
  assertAudit(source("lib/platform/supplier-masters.ts"), "更新供应商", "suppliers");
  assertAudit(source("lib/platform/supplier-masters.ts"), "删除供应商", "suppliers");
});

test("core commercial mutations write audit logs", () => {
  assertAudit(orders, "新增应收订单", "receivable_orders");
  assertAudit(orders, "更新应收订单", "receivable_orders");
  assertAudit(orders, "删除应收订单", "receivable_orders");
  assertAudit(payments, "删除收款", "payments");
  assert.match(payments, /auditAction/);
  assertAudit(costs, "新增成本", "order_costs");
  assertAudit(costs, "更新成本", "order_costs");
  assertAudit(costs, "确认成本", "order_costs");
  assertAudit(costs, "删除成本明细", "order_costs");
  assertAudit(costs, "作废成本明细", "order_costs");
});

test("document, tax refund, commission and logistics workflows write audit logs", () => {
  assertAudit(orderDocuments, "上传文件", "order_documents");
  assertAudit(orderDocuments, "报关单上传", "order_documents");
  assertAudit(orderDocuments, "删除文件", "order_documents");
  assertAudit(orderDocuments, "下载文件", "order_documents");
  assertAudit(orderDocuments, "预览文件", "order_documents");
  assertAudit(taxRefunds, "提交退税并归档", "receivable_orders");
  assertAudit(taxRefunds, "取消归档", "receivable_orders");
  assertAudit(taxRefunds, "结算业务员提成", "receivable_orders");
  assertAudit(domesticLogistics, "新增物流信息", "domestic_logistics_infos");
  assertAudit(domesticLogistics, "更新物流信息", "domestic_logistics_infos");
  assertAudit(domesticLogistics, "删除物流信息", "domestic_logistics_infos");
  assertAudit(domesticLogistics, "批量归档物流信息", "receivable_orders");
});

test("logistics bill, supplier document and ocean tracking workflows write audit logs", () => {
  for (const action of [
    "保存物流费用草稿",
    "提交物流费用审核",
    "审核通过物流费用账单",
    "驳回物流费用账单",
    "撤回物流费用账单",
    "批量保存物流费用账单明细",
    "提交物流分组发票",
    "删除物流分组发票",
    "确认物流发票",
    "更新物流费用付款状态",
  ]) {
    assertAudit(logisticsWorkflow, action, /账单|发票|付款/.test(action) ? "logistics_bills" : "logistics_expenses");
  }
  assertAudit(supplierDocuments, "通知供应商回传资料", "supplier_document_requests");
  assertAudit(supplierDocuments, "删除资料回传任务", "supplier_document_requests");
  assertAudit(supplierDocuments, "供应商上传回传资料", "order_documents");
  assertAudit(supplierDocuments, "下载供应商合同样本", "supplier_document_requests");
  assertAudit(shipsgoTracking, "创建飞驼可视海运跟踪", "shipsgo_trackings");
  assertAudit(shipsgoTracking, "同步飞驼可视海运跟踪", "shipsgo_trackings");
  assertAudit(shipsgoTracking, "同步飞驼可视已有跟踪", "shipsgo_trackings");
  assertAudit(shipsgoTracking, "定时同步飞驼可视海运跟踪", "shipsgo_trackings");
});

test("system settings and security audit guardrails cover audit logging", () => {
  assertAudit(companyProfile, "更新公司资料", "system_settings");
  assertAudit(commissionFormula, "更新提成公式设置", "system_settings");
  assertAudit(notificationTemplates, "更新物流费用通知模板", "system_settings");
  assert.match(securityAuditScript, /writeAuthAudit/);
});
