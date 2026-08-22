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
    url: "https://erp.example.com/api/supplier-purchase-orders",
    method,
    headers: { get: (name: string) => headers[name.toLowerCase()] || null },
    cookies: { get: () => undefined },
  };
}

test("供应商小程序使用显式 Bearer 会话且不依赖浏览器 Origin", () => {
  const token = "a".repeat(48);
  const nativeRequest = request({ authorization: `Bearer ${token}` });
  assert.equal(requestBearerToken(nativeRequest), token);
  const authRequest = readFileSync("lib/platform/shared-auth-request.ts", "utf8");
  assert.match(authRequest, /requestSessionToken[\s\S]*requestBearerToken\(request\)/);
  assert.match(authRequest, /assertSameOriginRequest[\s\S]*if \(requestBearerToken\(request\)\) return/);
});

test("供应商小程序拒绝过短或格式异常的 Bearer 凭证", () => {
  assert.equal(requestBearerToken(request({ authorization: "Bearer short" })), "");
  assert.equal(requestBearerToken(request({ authorization: `Bearer ${"a".repeat(40)}!` })), "");
});

test("全新供应商小程序登录只允许产品供应商并复用 RMB 会话", () => {
  const service = readFileSync("lib/platform/supplier-mini-auth.ts", "utf8");
  const route = readFileSync("app/api/supplier-mini/auth/login/route.ts", "utf8");
  assert.match(service, /PRODUCT_SUPPLIER_OPERATOR_ROLES/);
  assert.match(service, /PRODUCT_SUPPLIER_TYPES/);
  assert.match(service, /createUserSession\(request, user\)/);
  assert.match(service, /assertLoginNotRateLimited/);
  assert.match(route, /loginSupplierMiniProgram/);
  assert.doesNotMatch(route, /setSessionCookie/);
});

test("全新小程序只提供供应商采购与资料回传页面", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.deepEqual(manifest.pages, [
    "pages/login/index",
    "pages/home/index",
    "pages/purchase-orders/index",
    "pages/purchase-order-detail/index",
    "pages/documents/index",
    "pages/document-detail/index",
    "pages/profile/index",
  ]);
  assert.ok(!manifest.pages.some((page: string) => /tracking|logistics/.test(page)));
  const api = readFileSync("miniprogram/utils/api.js", "utf8");
  assert.match(api, /Authorization: `Bearer \$\{token\(\)\}`/);
  assert.match(api, /wx\.uploadFile/);
  assert.match(api, /supplier-document-requests/);
});
