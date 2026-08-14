import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";
import { availableMenus, MENU_ITEMS } from "../app/menu.ts";
import {
  effectivePermissions,
  MENU_KEYS,
  READ_PERMISSION_KEYS,
  rolePermissionSnapshot,
  SETTINGS_PERMISSION_LABELS,
  WRITE_PERMISSION_KEYS,
} from "../lib/platform/shared-permission-data.ts";
import type { User } from "../app/types.ts";

const jiti = createJiti(import.meta.url);
const { createWorkspaceTab, hasWorkspaceTabFocus } = await jiti.import("../app/workspace/workspace-tabs.ts") as typeof import("../app/workspace/workspace-tabs.ts");

const workspaceContent = readFileSync("app/WorkspaceModuleContent.tsx", "utf8");
const workspaceShell = readFileSync("app/WorkspaceShell.tsx", "utf8");
const quotationsModule = readFileSync("app/modules/QuotesModule.tsx", "utf8");
const quotationView = readFileSync("app/modules/quotations/quotations-module-view.tsx", "utf8");
const quotationDrawer = readFileSync("app/modules/quotations/quotation-detail-drawer.tsx", "utf8");
const quotationQuery = readFileSync("lib/platform/quotation-query-service.ts", "utf8");
const quotationValues = readFileSync("lib/platform/quotation-values.ts", "utf8");
const salesExecutionModule = readFileSync("app/modules/SalesExecutionModule.tsx", "utf8");
const salesExecutionForm = readFileSync("app/modules/sales-execution/execution-form-panel.tsx", "utf8");
const quotationConversionPanel = readFileSync("app/modules/sales-execution/quotation-conversion-panel.tsx", "utf8");
const salesExecutionRoute = readFileSync("app/api/sales-executions/route.ts", "utf8");
const salesExecutionService = readFileSync("lib/platform/sales-execution-service.ts", "utf8");
const customerMasters = readFileSync("lib/platform/customer-masters.ts", "utf8");
const supplierSelection = readFileSync("lib/platform/supplier-selection.ts", "utf8");
const businessEntitySettings = readFileSync("lib/platform/business-entity-settings.ts", "utf8");
const auditLogs = readFileSync("lib/platform/audit-logs.ts", "utf8");

function user(role: string): User {
  return { id: `${role}-user`, name: role, email: `${role}@example.com`, role };
}

test("sales execution is writable by sales roles and read-only for finance payment work", () => {
  assert.equal(MENU_ITEMS.find((item) => item.key === "salesExecution")?.label, "销售执行");
  for (const role of ["管理员", "业务员"]) {
    const snapshot = rolePermissionSnapshot(role);
    assert.equal(availableMenus(user(role)).some((item) => item.key === "salesExecution"), true);
    assert.equal(snapshot.reads.salesExecution, true);
    assert.equal(snapshot.writes.salesExecution, true);
  }
  const finance = rolePermissionSnapshot("财务");
  assert.equal(availableMenus(user("财务")).some((item) => item.key === "salesExecution"), true);
  assert.equal(finance.reads.salesExecution, true);
  assert.equal(finance.writes.salesExecution, false);
  for (const role of ["物流供应商", "产品供应商", "物流资料录入员"]) {
    const snapshot = rolePermissionSnapshot(role);
    assert.equal(snapshot.menus.includes("salesExecution"), false);
    assert.equal(snapshot.reads.salesExecution, false);
    assert.equal(snapshot.writes.salesExecution, false);
  }
});

test("sales execution is available to custom permission configuration", () => {
  assert.equal(MENU_KEYS.includes("salesExecution"), true);
  assert.equal(READ_PERMISSION_KEYS.includes("salesExecution"), true);
  assert.equal(WRITE_PERMISSION_KEYS.includes("salesExecution"), true);
  assert.equal(SETTINGS_PERMISSION_LABELS.menu.salesExecution, "销售执行");
  assert.equal(SETTINGS_PERMISSION_LABELS.read.salesExecution, "销售执行查看");
  assert.equal(SETTINGS_PERMISSION_LABELS.write.salesExecution, "销售执行维护");
});

test("supplier accounts cannot be granted internal quotation or sales execution access", () => {
  for (const role of ["产品供应商", "产品供应商账号", "工厂供应商账号", "物流供应商"]) {
    const permissions = effectivePermissions({
      role,
      customPermissions: {
        mode: "CUSTOM",
        menus: ["quotations", "salesExecution"],
        reads: ["quotations", "salesExecution"],
        writes: ["quotations", "salesExecution"],
        dataScope: "ALL",
      },
    });
    assert.equal(permissions.menus.includes("quotations"), false);
    assert.equal(permissions.reads.quotations, false);
    assert.equal(permissions.writes.quotations, false);
    assert.equal(permissions.menus.includes("salesExecution"), false);
    assert.equal(permissions.reads.salesExecution, false);
    assert.equal(permissions.writes.salesExecution, false);
  }
});

test("workspace focus keeps quotation conversion and execution detail tabs distinct", () => {
  assert.equal(hasWorkspaceTabFocus({ quotationId: "quote-1", action: "convert" }), true);
  assert.equal(hasWorkspaceTabFocus({ executionId: "execution-1" }), true);
  const conversion = createWorkspaceTab({
    id: "sales-execution:convert",
    menuKey: "salesExecution",
    focus: { quotationId: "quote-1", action: "convert" },
  });
  assert.equal(conversion.focus.quotationId, "quote-1");
  assert.equal(conversion.focus.action, "convert");
  assert.ok(conversion.focus.token > 0);
});

test("workspace lazy-loads both sales execution entry points and supports deep links", () => {
  assert.match(workspaceContent, /const SalesExecutionModule = dynamic/);
  assert.match(workspaceContent, /activeMenu === "salesExecution"/);
  assert.match(workspaceContent, /initialAction=\{focus\.action\}/);
  assert.match(workspaceContent, /initialQuotationId=\{focus\.quotationId\}/);
  assert.match(workspaceContent, /initialExecutionId=\{focus\.executionId\}/);
  assert.match(workspaceShell, /path === "sales-execution"/);
  assert.match(workspaceShell, /quotationId: parsed\.searchParams\.get\("quotationId"\)/);
  assert.match(workspaceShell, /executionId: parsed\.searchParams\.get\("executionId"\)/);
});

test("accepted quotation detail is wired to a server-validated conversion workflow", () => {
  assert.match(quotationsModule, /canWriteSalesExecution/);
  assert.match(quotationView, /hasCurrentManualQuotationAcceptance\(detailQuotation\)/);
  assert.match(quotationView, /Boolean\(detailQuotation\.salesExecution\?\.id\)/);
  assert.match(quotationDrawer, /"转为销售执行"/);
  assert.match(workspaceContent, /action: "convert"/);
  assert.match(workspaceContent, /quotationId/);
  assert.match(salesExecutionModule, /prepareQuotationConversion/);
  assert.match(salesExecutionModule, /setConversionDraft\(\{[\s\S]*customerOrderNo:\s*""[\s\S]*requestedDeliveryDate:\s*""/);
  assert.match(quotationConversionPanel, /客户订单号[\s\S]*<input required/);
  assert.match(quotationConversionPanel, /客户要求交货日期[\s\S]*<input type="date" required/);
  assert.match(salesExecutionModule, /body:\s*JSON\.stringify\(\{ sourceType:\s*"QUOTATION", \.\.\.draft \}\)/);
  assert.match(salesExecutionRoute, /createSalesExecution/);
  assert.match(salesExecutionService, /createSalesExecutionFromQuotation/);
});

test("an already converted quotation opens its linked sales execution", () => {
  assert.match(quotationQuery, /salesExecution:\s*\{ select:\s*\{ id: true, customerOrderNo: true, status: true \} \}/);
  assert.match(quotationQuery, /effectivePermissions\(actor\)\.reads\.salesExecution/);
  assert.match(quotationValues, /includeSalesExecution && salesExecution\.id/);
  assert.match(quotationValues, /customerOrderNo: String\(salesExecution\.customerOrderNo/);
  assert.doesNotMatch(quotationValues, /executionNo: String\(salesExecution\.executionNo/);
  assert.match(quotationDrawer, /quotation\.salesExecution\?\.id \? "\u6253\u5f00\u9500\u552e\u6267\u884c" : "\u8f6c\u4e3a\u9500\u552e\u6267\u884c"/);
  assert.match(workspaceContent, /executionId \? \{[\s\S]*executionId,[\s\S]*\} : \{ action: "convert", quotationId \}/);
});

test("direct and quotation entry points enforce the same order credential contract", () => {
  assert.match(salesExecutionForm, /客户订单号[\s\S]{0,180}<input required/);
  assert.match(salesExecutionForm, /客户要求交货日期[\s\S]{0,180}<input type="date" required/);
  assert.match(quotationConversionPanel, /保留为客户原始要求/);
  assert.match(quotationConversionPanel, /不覆盖此记录/);
});

test("customer and factory option services recognize sales execution write permission", () => {
  assert.match(customerMasters, /canWrite\(actor, "salesExecution"\)/);
  assert.match(supplierSelection, /permissions\.writes\.salesExecution/);
  assert.match(businessEntitySettings, /canRead\(actor, "salesExecution"\)/);
});

test("salesperson audit scope includes owned sales execution records", () => {
  assert.match(auditLogs, /prisma\.salesExecution\.findMany/);
  assert.match(auditLogs, /entityType: "sales_executions"/);
  assert.match(auditLogs, /sales_executions: "销售执行单"/);
});
