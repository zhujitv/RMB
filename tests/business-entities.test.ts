import { readPrismaSchemaSource } from "./prisma-schema-source.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  readBusinessEntitiesSource,
  readCostRecordsQueriesSource,
  readCostsModuleSource,
  readCustomerCommunicationModuleSource,
  readCustomerCommunicationServiceSource,
  readDomesticLogisticsModuleSource,
  readLogisticsExpenseAccessSource,
  readLogisticsFeesModuleSource,
  readOrdersModuleSource,
  readOrdersServiceSource,
  readPaymentsModuleSource,
  readPaymentsServiceSource,
  readProfitModuleSource,
  readReportServiceSource,
  readReportsModuleSource,
  readSettingsModuleSource,
  readSharedOrderSerializationSource,
  readSharedSerializationSource,
  readSupplierDocumentRequestsSource,
  readSupplierDocumentsModuleSource,
  readTaxRefundModuleSource,
  readTaxRefundsSource,
  readWorkspaceStylesSource,
} from "./source-helpers.ts";

const schema = readPrismaSchemaSource();
const migration = readFileSync("prisma/migrations/20260701223000_business_entities/migration.sql", "utf8");
const service = readBusinessEntitiesSource();
const shared = readFileSync("lib/platform/shared.ts", "utf8");
const ordersService = readOrdersServiceSource();
const orderRelations = readFileSync("lib/platform/shared-order-relations.ts", "utf8");
const orderSerialization = readSharedOrderSerializationSource();
const orderModel = readFileSync("app/modules/orders/model.ts", "utf8");
const ordersModule = readOrdersModuleSource();
const quickOrderPanel = ordersModule;
const orderDetailDrawer = readFileSync("app/modules/orders/detail-drawer.tsx", "utf8");
const reportService = readReportServiceSource();
const taxRefundService = readTaxRefundsSource();
const taxRefundListPanel = readTaxRefundModuleSource();
const taxRefundTableRow = readTaxRefundModuleSource();
const taxRefundHelpers = readTaxRefundModuleSource();
const taxRefundController = readTaxRefundModuleSource();
const reportsModule = readReportsModuleSource();
const listRoute = readFileSync("app/api/business-entities/route.ts", "utf8");
const transferRoute = readFileSync("app/api/orders/[id]/business-entity/route.ts", "utf8");
const settingsTypes = readSettingsModuleSource();
const settingsConstants = readSettingsModuleSource();
const settingsCards = readSettingsModuleSource();
const settingsController = readSettingsModuleSource();
const settingsView = readSettingsModuleSource();
const settingsRoute = readFileSync("app/api/settings/business-entities/route.ts", "utf8");
const settingsSealRoute = readFileSync("app/api/settings/business-entities/[id]/seal/route.ts", "utf8");
const workspaceStyles = readWorkspaceStylesSource();
const fileAssetData = readFileSync("lib/platform/file-asset-data.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const rowStyleHelper = readFileSync("app/modules/business-entity-row-style.ts", "utf8");
const paymentsModule = readPaymentsModuleSource();
const paymentsService = readPaymentsServiceSource();
const costsModule = readCostsModuleSource();
const costQueries = readCostRecordsQueriesSource();
const logisticsFeesModule = readLogisticsFeesModuleSource();
const logisticsExpenseAccess = readLogisticsExpenseAccessSource();
const domesticLogisticsModule = readDomesticLogisticsModuleSource();
const profitModule = readProfitModuleSource();
const customerCommunicationModule = readCustomerCommunicationModuleSource();
const customerCommunicationService = readCustomerCommunicationServiceSource();
const sharedSerialization = readSharedSerializationSource();
const supplierDocumentsModule = readSupplierDocumentsModuleSource();
const supplierDocumentRequests = readSupplierDocumentRequestsSource();

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
  assert.match(shared, /export \* from "\.\/business-entity-seal"/);
  assert.match(service, /DEFAULT_BUSINESS_ENTITY_NAME = "浙江莱诺建材有限公司"/);
  assert.match(service, /displayName: shortName \|\| name/);
  assert.match(service, /getDefaultBusinessEntity/);
  assert.match(service, /resolveBusinessEntityForOrderInput/);
  assert.match(service, /businessEntityWhereFromQuery/);
  assert.match(service, /transferOrderBusinessEntity/);
  assert.match(service, /writeAudit\(/);
  assert.match(ordersService, /resolveBusinessEntityForOrderInput\(inputData, current, tx\)/);
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
  assert.match(quickOrderPanel, /businessEntityId: form\.businessEntityId \|\| undefined/);
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
  assert.match(reportsModule, /onFilterChange\("businessEntityId"/);
  assert.match(reportsModule, /onFilterChange=\{updateFilter\}/);
});

test("tax refund list exposes business entity filter display and export column", () => {
  assert.match(taxRefundService, /businessEntityWhereFromQuery\(filters\.businessEntityId\)/);
  assert.match(taxRefundService, /businessEntityFieldsFromOrder\(order\)/);
  assert.doesNotMatch(taxRefundService, /businessEntitySortDirection/);
  assert.match(taxRefundController, /\/api\/business-entities/);
  assert.match(taxRefundController, /params\.set\("businessEntityId"/);
  assert.doesNotMatch(taxRefundController, /businessEntitySortDirection|toggleBusinessEntitySort/);
  assert.match(taxRefundListPanel, /全部业务主体/);
  assert.match(taxRefundListPanel, /taxRefundBusinessEntityColumn/);
  assert.match(taxRefundListPanel, /<th className=\{styles\.taxRefundBusinessEntityColumn\}>业务主体<\/th>/);
  assert.doesNotMatch(taxRefundListPanel, /onToggleBusinessEntitySort|tableSortButton|业务主体\{businessEntitySortDirection/);
  assert.match(taxRefundTableRow, /businessEntityDisplayName \|\| row\.businessEntityShortName \|\| businessEntityFullName/);
  assert.match(taxRefundTableRow, /title=\{businessEntityFullName \|\| "-"\}/);
  assert.match(taxRefundHelpers, /businessEntityNameSnapshot/);
  assert.match(reportService.match(/"tax-refunds":\s*\[[\s\S]*?\n  \]/)?.[0] || "", /\["businessEntityName", "业务主体"\]/);
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
  assert.match(settingsCards, /已封存版本不会被追溯改写/);
  assert.match(settingsCards, /英文法定抬头/);
  assert.match(settingsCards, /人民币国际汇款账户/);
  assert.match(settingsCards, /中国地区纳税人识别号/);
  assert.match(settingsCards, /中国地区开户行/);
  assert.match(settingsCards, /中国地区银行账号/);
  assert.match(settingsCards, /人民币国际汇款账户（报价 \/ PI）/);
  assert.match(service, /domesticBankPayload\(input\)/);
  assert.match(service, /delete safeEntity\.domesticBankAccount/);
  assert.match(settingsCards, /国际汇款 SWIFT \/ BIC（可选）/);
  assert.match(settingsCards, /美元收款账户/);
  assert.match(settingsCards, /Beneficiary Name/);
  assert.match(settingsCards, /Beneficiary Address/);
  assert.match(settingsCards, /Bank Name/);
  assert.match(settingsCards, /Account Number/);
  assert.match(settingsCards, /SWIFT \/ BIC Code/);
  assert.match(service, /currency === "CNY"\s*\? \[bankName, accountNumber\]/);
  assert.match(service, /人民币收款账户请同时填写开户行和银行账号/);
  assert.match(settingsCards, /PI 页头显示公司电话/);
  assert.match(settingsCards, /PI 页头显示公司邮箱/);
  assert.match(settingsCards, /PI 页头显示公司网址/);
  assert.match(settingsCards, /需方电子章/);
  assert.match(settingsCards, /透明背景 PNG/);
  assert.match(settingsCards, /\/api\/settings\/business-entities\/\$\{encodeURIComponent\(entityId\)\}\/seal/);
  assert.match(settingsCards, /validateElectronicSealUploadFile/);
  assert.match(settingsCards, /onSealSaved/);
  assert.match(settingsCards, /公司地址始终显示/);
  assert.match(settingsController, /请填写公司全称/);
  assert.match(settingsController, /\/api\/settings\/business-entities/);
  assert.match(settingsView, /activeTab === "businessEntities"/);
});

test("business entities maintain a private electronic seal for supplier contracts", () => {
  assert.match(fileAssetData, /BUSINESS_ENTITIES: "business_entities"/);
  assert.match(fileAssetData, /BUSINESS_ENTITY_ELECTRONIC_SEAL/);
  assert.match(service, /PDFDocument/);
  assert.match(service, /embedPng/);
  assert.match(service, /page\.drawImage\(seal/);
  assert.match(service, /locateSupplierContractSealAnchor/);
  assert.match(service, /supplierContractSealPlacement/);
  assert.match(service, /resize\(\{ width: 450, height: 450/);
  assert.doesNotMatch(service, /y:\s*64/);
  assert.match(service, /business-entities\/\$\{safeEntityId\}\/electronic-seal/);
  assert.match(service, /serializeBusinessEntitySettings\(row, serializeBusinessEntityElectronicSeal/);
  assert.match(service, /hasElectronicSeal/);
  assert.match(settingsSealRoute, /uploadBusinessEntityElectronicSeal/);
  assert.match(settingsSealRoute, /readBusinessEntityElectronicSealImage/);
  assert.match(settingsSealRoute, /deleteBusinessEntityElectronicSeal/);
  assert.match(settingsSealRoute, /assertMultipartRequestWithinLimit/);
  assert.match(packageJson, /"pdf-lib"/);
});

test("business entity rows use one shared non-default highlight rule", () => {
  assert.match(rowStyleHelper, /getBusinessEntityRowClass/);
  assert.match(rowStyleHelper, /businessEntityIsDefault/);
  assert.match(rowStyleHelper, /nested\.isDefault/);
  assert.match(workspaceStyles, /businessEntityOtherRow/);
  assert.match(workspaceStyles, /#f3f8ff/i);
  assert.match(workspaceStyles, /#eaf4ff/i);
  assert.match(workspaceStyles, /logisticsCompactRowActive/);

  assert.match(service, /businessEntityIsDefault/);
  assert.match(orderSerialization, /businessEntityFieldsFromOrder\(order\)/);
  assert.match(sharedSerialization, /businessEntityFieldsFromOrder\(payment\.order\)/);
  assert.match(costQueries, /businessEntity: true/);
  assert.match(logisticsExpenseAccess, /businessEntityIsDefault/);
  assert.match(taxRefundService, /businessEntityIsDefault/);
  assert.match(reportService, /businessEntityIsDefault/);
  assert.match(customerCommunicationService, /businessEntityIsDefault/);
  assert.match(supplierDocumentRequests, /businessEntityFieldsFromOrder\(row\.order\)/);

  [
    ordersModule,
    paymentsModule,
    costsModule,
    logisticsFeesModule,
    domesticLogisticsModule,
    profitModule,
    reportsModule,
    taxRefundListPanel,
    customerCommunicationModule,
    supplierDocumentsModule,
  ].forEach((source) => {
    assert.match(source, /getBusinessEntityRowClass/);
  });
});
