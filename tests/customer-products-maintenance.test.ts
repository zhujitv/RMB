import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerSource = readFileSync("app/modules/settings/customer-products-manager.tsx", "utf8");
const tableSource = readFileSync("app/modules/settings/settings-table.tsx", "utf8");
const serviceSource = readFileSync("lib/platform/quotation-customer-products.ts", "utf8");
const schemaSource = readFileSync("prisma/models/quotations.prisma", "utf8");

test("customer details expose a product attribute maintenance entry", () => {
  assert.match(tableSource, /onManageProducts/);
  assert.match(tableSource, />产品属性<\/button>/);
  assert.match(tableSource, /onManageProducts\(row as CustomerRow\)/);
  assert.match(tableSource, /<CustomerProductsManager customer=\{productCustomer\}/);
});

test("customer product manager supports search create edit and void", () => {
  assert.match(managerSource, /\/api\/customer-products\?\$\{params\}/);
  assert.match(managerSource, /method: form\.id \? "PATCH" : "POST"/);
  assert.match(managerSource, /method: "DELETE"/);
  assert.match(managerSource, /历史报价和销售数据不会改变/);
  assert.match(managerSource, /<PaginationBar/);
});

test("customer products remain customer-scoped and deduplicated", () => {
  assert.match(schemaSource, /model CustomerProduct[\s\S]*@@unique\(\[customerId, fingerprint\]\)/);
  assert.match(serviceSource, /await assertCustomerScope\(actor, customerId\)/);
  assert.match(serviceSource, /该客户已存在相同品名、规格和单位的产品/);
  assert.match(serviceSource, /data: \{ deletedAt: new Date\(\), updatedById: actorId \}/);
});
