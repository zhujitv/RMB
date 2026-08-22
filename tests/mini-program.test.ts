import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { requestBearerToken } = await jiti.import<typeof import("../lib/platform/shared-auth-bearer.ts")>(
  "../lib/platform/shared-auth-bearer.ts",
);

function request(headers: Record<string, string> = {}, method = "POST") {
  return {
    url: "https://erp.example.com/api/auth/me",
    method,
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
    cookies: { get: () => undefined },
  };
}

test("RMB 小程序使用显式 Bearer 会话且不依赖浏览器 Origin", () => {
  const token = "a".repeat(48);
  const nativeRequest = request({ authorization: `Bearer ${token}` });
  assert.equal(requestBearerToken(nativeRequest), token);
  const authRequest = readFileSync("lib/platform/shared-auth-request.ts", "utf8");
  assert.match(authRequest, /requestSessionToken[\s\S]*requestBearerToken\(request\)/);
  assert.match(authRequest, /assertSameOriginRequest[\s\S]*if \(requestBearerToken\(request\)\) return/);
});

test("RMB 小程序拒绝过短或格式异常的 Bearer 凭证", () => {
  assert.equal(requestBearerToken(request({ authorization: "Bearer short" })), "");
  assert.equal(requestBearerToken(request({ authorization: `Bearer ${"a".repeat(40)}!` })), "");
});

test("统一登录允许所有合规 RMB 账号并复用 RMB 会话", () => {
  const service = readFileSync("lib/platform/mini-auth.ts", "utf8");
  const route = readFileSync("app/api/mini/auth/login/route.ts", "utf8");
  assert.match(service, /createUserSession\(request, user\)/);
  assert.match(service, /assertLoginNotRateLimited/);
  assert.doesNotMatch(service, /PRODUCT_SUPPLIER_OPERATOR_ROLES|SUPPLIER_MINI_ROLE_NOT_ALLOWED|SUPPLIER_NOT_BOUND/);
  assert.match(route, /loginMiniProgram/);
  assert.doesNotMatch(route, /setSessionCookie/);
});

test("统一首页按权限展示模块且供应商能力只是其中一部分", () => {
  const home = readFileSync("miniprogram/pages/home/index.js", "utf8");
  const login = readFileSync("miniprogram/pages/login/index.js", "utf8");
  assert.match(login, /\/api\/mini\/auth\/login/);
  assert.match(home, /\/api\/auth\/permissions/);
  assert.match(home, /menuKeys\.includes\("supplierPurchaseOrders"\)/);
  assert.match(home, /menuKeys\.includes\("supplierDocuments"\)/);
  assert.match(home, /网页端可用/);
  assert.match(home, /key === "quotations"[\s\S]*customer-quotes/);
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.equal(manifest.window.navigationBarTitleText, "NEXTWOOD RMB");
});

test("客户与报价已接入小程序查询详情和报价草稿闭环", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const page of ["pages/customer-quotes/index", "pages/quotation-detail/index", "pages/quotation-form/index"]) {
    assert.ok(manifest.pages.includes(page));
  }
  const workspace = readFileSync("miniprogram/pages/customer-quotes/index.js", "utf8");
  const detail = readFileSync("miniprogram/pages/quotation-detail/index.js", "utf8");
  const form = readFileSync("miniprogram/pages/quotation-form/index.js", "utf8");
  assert.match(workspace, /\/api\/customers/);
  assert.match(workspace, /\/api\/quotations/);
  assert.match(detail, /\/api\/quotations\/\$\{encodeURIComponent\(this\.data\.id\)\}/);
  assert.match(form, /\/api\/business-entities/);
  assert.match(form, /method: this\.data\.id \? "PATCH" : "POST"/);
  assert.match(form, /expectedVersionNumber/);
});

test("销售执行已接入小程序列表详情和直接创建闭环", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const page of ["pages/sales-executions/index", "pages/sales-execution-detail/index", "pages/sales-execution-form/index"]) assert.ok(manifest.pages.includes(page));
  const list = readFileSync("miniprogram/pages/sales-executions/index.js", "utf8");
  const detail = readFileSync("miniprogram/pages/sales-execution-detail/index.js", "utf8");
  const form = readFileSync("miniprogram/pages/sales-execution-form/index.js", "utf8");
  assert.match(list, /\/api\/sales-executions/);
  assert.match(detail, /purchaseOrders: row\.purchaseOrders \|\| \[\]/);
  assert.match(form, /\/api\/suppliers\/available/);
  assert.match(form, /sourceType: "DIRECT"/);
  assert.match(form, /executionLineNumber: i \+ 1/);
});

test("应收订单已接入小程序列表详情和草稿创建闭环", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const page of ["pages/orders/index", "pages/order-detail/index", "pages/order-form/index"]) assert.ok(manifest.pages.includes(page));
  const list = readFileSync("miniprogram/pages/orders/index.js", "utf8");
  const detail = readFileSync("miniprogram/pages/order-detail/index.js", "utf8");
  const form = readFileSync("miniprogram/pages/order-form/index.js", "utf8");
  assert.match(list, /workspace=1/);
  assert.match(list, /arrivedOutstandingAmount/);
  assert.match(detail, /\/api\/orders\/\$\{encodeURIComponent\(this\.data\.id\)\}/);
  assert.match(form, /tradeTerm !== "EXW"/);
  assert.match(form, /estimatedReceivableAmount: Number/);
  assert.match(form, /method: "POST"/);
});

test("供应商采购和资料页面仍由统一小程序提供", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.ok(manifest.pages.includes("pages/purchase-orders/index"));
  assert.ok(manifest.pages.includes("pages/documents/index"));
  const api = readFileSync("miniprogram/utils/api.js", "utf8");
  assert.match(api, /Authorization: `Bearer \$\{token\(\)\}`/);
  assert.match(api, /wx\.uploadFile/);
  assert.match(api, /supplier-document-requests/);
});
