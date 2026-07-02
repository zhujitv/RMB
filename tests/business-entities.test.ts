import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20260701223000_business_entities/migration.sql", "utf8");
const service = readFileSync("lib/platform/business-entities.ts", "utf8");
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const ordersService = readFileSync("lib/platform/orders-module.ts", "utf8");
const orderRelations = readFileSync("lib/platform/shared-order-relations.ts", "utf8");
const orderSerialization = readFileSync("lib/platform/shared-order-serialization-impl.ts", "utf8");
const orderModel = readFileSync("app/modules/orders/model.ts", "utf8");
const quickOrderPanel = readFileSync("app/modules/orders/quick-order-panel.tsx", "utf8");
const ordersModule = readFileSync("app/modules/OrdersModule.tsx", "utf8");
const orderDetailDrawer = readFileSync("app/modules/orders/detail-drawer.tsx", "utf8");
const reportService = readFileSync("lib/report-service.ts", "utf8");
const reportsModule = readFileSync("app/modules/ReportsModule.tsx", "utf8");
const listRoute = readFileSync("app/api/business-entities/route.ts", "utf8");
const transferRoute = readFileSync("app/api/orders/[id]/business-entity/route.ts", "utf8");
const settingsTypes = readFileSync("app/modules/settings/types.ts", "utf8");
const settingsConstants = readFileSync("app/modules/settings/constants.ts", "utf8");
const settingsCards = readFileSync("app/modules/settings/settings-cards.tsx", "utf8");
const settingsController = readFileSync("app/modules/settings/use-settings-controller.ts", "utf8");
const settingsView = readFileSync("app/modules/settings/module-view.tsx", "utf8");
const settingsRoute = readFileSync("app/api/settings/business-entities/route.ts", "utf8");

test("business entities are modeled as order-level markers", () => {
  assert.match(schema, /model BusinessEntity/);
  assert.match(schema, /@@map\("business_entities"\)/);
  assert.match(schema, /businessEntityId\s+String\?\s+@map\("business_entity_id"\)/);
  assert.match(schema, /businessEntityNameSnapshot\s+String\?\s+@map\("business_entity_name_snapshot"\)/);
  assert.match(schema, /businessEntity\s+BusinessEntity\?\s+@relation/);
  assert.match(schema, /receivable_orders_business_entity_idx/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "business_entities"/);
  assert.match(migration, /business_entities_single_default_idx/);
  assert.match(migration, /INSERT INTO "business_entities"/);
  assert.match(migration, /UPDATE "receivable_orders"/);
});

test("order APIs assign default business entity and protect transfers", () => {
  assert.match(shared, /export \* from "\.\/business-entities"/);
  assert.match(service, /DEFAULT_BUSINESS_ENTITY_NAME = "浙江莱诺建材有限公司"/);
  assert.match(service, /displayName: shortName \|\| name/);
  assert.match(service, /getDefaultBusinessEntity/);
  assert.match(service, /resolveBusinessEntityForOrderInput/);
  assert.match(service, /businessEntityWhereFromQuery/);
  assert.match(service, /transferOrderBusinessEntity/);
  assert.match(service, /writeAudit\(/);
  assert.match(ordersService, /resolveBusinessEntityForOrderInput\(inputData, before\)/);
  assert.match(ordersService, /BUSINESS_ENTITY_TRANSFER_REQUIRED/);
  assert.match(ordersService, /businessEntityId: businessEntity\.id/);
  assert.match(ordersService, /businessEntityNameSnapshot: businessEntity\.name/);
  assert.match(orderRelations, /businessEntity: true/);
  assert.match(orderSerialization, /businessEntityFieldsFromOrder\(order\)/);
  assert.match(listRoute, /listBusinessEntities\(actor/);
  assert.match(transferRoute, /transferOrderBusinessEntity\(request, actor, id, body\)/);
});

test("orders UI can select filter display and transfer business entity", () => {
  assert.match(orderModel, /export type BusinessEntityOption/);
  assert.match(orderModel, /businessEntityDisplayName\?: string/);
  assert.match(orderModel, /businessEntityId: string/);
  assert.match(quickOrderPanel, /\/api\/business-entities/);
  assert.match(quickOrderPanel, /业务主体/);
  assert.match(quickOrderPanel, /disabled=\{Boolean\(initialOrder\?\.id\)\}/);
  assert.match(quickOrderPanel, /businessEntityId: form\.businessEntityId/);
  assert.match(ordersModule, /全部业务主体/);
  assert.match(ordersModule, /businessEntityColumn/);
  assert.match(ordersModule, /entity\.displayName \|\| entity\.shortName \|\| entity\.name/);
  assert.match(ordersModule, /params\.set\("businessEntityId"/);
  assert.match(ordersModule, /onBusinessEntityTransferred/);
  assert.match(quickOrderPanel, /entity\.displayName \|\| entity\.shortName \|\| entity\.name/);
  assert.match(orderDetailDrawer, /业务主体转移/);
  assert.match(orderDetailDrawer, /\/api\/orders\/\$\{encodeURIComponent\(order\.id\)\}\/business-entity/);
});

test("reports expose business entity columns and filters", () => {
  assert.match(reportService, /"businessEntityId"/);
  assert.match(reportService, /"businessEntityName"/);
  assert.match(reportService, /businessEntityDisplayName/);
  assert.match(reportService, /\["businessEntityName", "业务主体"\]/);
  assert.match(reportService, /row\.businessEntityId !== businessEntityId/);
  assert.match(reportsModule, /businessEntityId: ""/);
  assert.match(reportsModule, /\/api\/business-entities/);
  assert.match(reportsModule, /全部业务主体/);
  assert.match(reportsModule, /businessEntityDisplayName/);
  assert.match(reportsModule, /businessEntityFullName\(row\)/);
  assert.match(reportsModule, /updateFilter\("businessEntityId"/);
});

test("settings can maintain business entities without making it multi tenant", () => {
  assert.match(service, /listBusinessEntitySettings/);
  assert.match(service, /createBusinessEntitySetting/);
  assert.match(service, /updateBusinessEntitySetting/);
  assert.match(service, /新增业务主体/);
  assert.match(settingsRoute, /listBusinessEntitySettings\(actor\)/);
  assert.match(settingsRoute, /createBusinessEntitySetting\(request, actor, body\)/);
  assert.match(settingsRoute, /updateBusinessEntitySetting\(request, actor, id, body\)/);
  assert.match(settingsTypes, /"businessEntities"/);
  assert.match(settingsTypes, /export type BusinessEntityForm/);
  assert.match(settingsConstants, /业务主体/);
  assert.match(settingsCards, /BusinessEntitySettingsCard/);
  assert.match(settingsCards, /公司全称/);
  assert.match(settingsCards, /公司简称/);
  assert.match(settingsCards, /业务主体用于订单标记、筛选、报表和导出抬头，不改变权限隔离和业务流程/);
  assert.match(settingsController, /请填写公司全称/);
  assert.match(settingsController, /\/api\/settings\/business-entities/);
  assert.match(settingsView, /activeTab === "businessEntities"/);
});
