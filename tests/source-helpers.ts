import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function isSourceFile(path: string) {
  return [...SOURCE_EXTENSIONS].some((extension) => path.endsWith(extension));
}

function readSourceTree(root: string) {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const nextPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...readSourceTree(nextPath));
    } else if (entry.isFile() && isSourceFile(nextPath)) {
      files.push(nextPath);
    }
  }
  return files.sort();
}

function readSourcePrefix(dir: string, prefixes: string[]) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => prefixes.some((prefix) => file === `${prefix}.ts` || file === `${prefix}.tsx` || file.startsWith(`${prefix}-`)))
    .filter(isSourceFile)
    .map((file) => join(dir, file))
    .sort();
}

const SETTINGS_MODULE_FILES = [
  "app/modules/SettingsModule.tsx",
  "app/modules/settings/use-settings-controller.ts",
  "app/modules/settings/use-settings-controller-actions.ts",
  "app/modules/settings/use-settings-entity-save-actions.ts",
  "app/modules/settings/use-settings-load-actions.ts",
  "app/modules/settings/use-settings-save-actions.ts",
  "app/modules/settings/use-settings-system-save-actions.ts",
  "app/modules/settings/use-settings-state.ts",
  "app/modules/settings/module-edit-panels.tsx",
  "app/modules/settings/module-tab-content.tsx",
  "app/modules/settings/module-toolbar.tsx",
  "app/modules/settings/module-view.tsx",
  "app/modules/settings/types.ts",
  "app/modules/settings/constants.ts",
  "app/modules/settings/helpers.ts",
  "app/modules/settings/settings-config-helpers.ts",
  "app/modules/settings/settings-display-helpers.ts",
  "app/modules/settings/settings-form-helpers.ts",
  "app/modules/settings/settings-label-helpers.ts",
  "app/modules/settings/settings-layout.tsx",
  "app/modules/settings/settings-query-helpers.ts",
  "app/modules/settings/common-controls.tsx",
  "app/modules/settings/business-entity-settings-card.tsx",
  "app/modules/settings/commission-formula-settings-card.tsx",
  "app/modules/settings/company-profile-settings-card.tsx",
  "app/modules/settings/customer-supplier-panels.tsx",
  "app/modules/settings/exchange-settings-card.tsx",
  "app/modules/settings/notification-template-settings-card.tsx",
  "app/modules/settings/ocr-integration-settings-card.tsx",
  "app/modules/settings/settings-cards.tsx",
  "app/modules/settings/settings-table.tsx",
  "app/modules/settings/settings-home-grid.tsx",
  "app/modules/settings/settings-view-constants.ts",
  "app/modules/settings/freightower-integration-settings-card.tsx",
  "app/modules/settings/user-edit-panel.tsx",
];

const DOMESTIC_LOGISTICS_MODULE_FILES = [
  "app/modules/DomesticLogisticsModule.tsx",
  "app/modules/domestic-logistics/model.ts",
  "app/modules/domestic-logistics/helpers.ts",
  "app/modules/domestic-logistics/shipsgo-format.ts",
  "app/modules/domestic-logistics/control-tower.tsx",
  "app/modules/domestic-logistics/control-tower-components.tsx",
  "app/modules/domestic-logistics/customs-documents-panel.tsx",
  "app/modules/domestic-logistics/edit-panel.tsx",
  "app/modules/domestic-logistics/module-view.tsx",
  "app/modules/domestic-logistics/order-tracking-panel.tsx",
  "app/modules/domestic-logistics/rows.tsx",
  "app/modules/domestic-logistics/use-domestic-logistics-actions.ts",
];

const TAX_REFUND_MODULE_FILES = [
  "app/modules/TaxRefundModule.tsx",
  "app/modules/tax-refund/use-tax-refund-controller.ts",
  "app/modules/tax-refund/use-tax-refund-detail-actions.ts",
  "app/modules/tax-refund/use-tax-refund-state.ts",
  "app/modules/tax-refund/list-panel.tsx",
  "app/modules/tax-refund/overlays.tsx",
  "app/modules/tax-refund/model.ts",
  "app/modules/tax-refund/helpers.ts",
  "app/modules/tax-refund/detail-components.tsx",
  "app/modules/tax-refund/detail-panel.tsx",
  "app/modules/tax-refund/detail-section-state.ts",
  "app/modules/tax-refund/table-row.tsx",
  "app/modules/tax-refund/upload-card.tsx",
  "app/modules/tax-refund/upload-components.tsx",
  "app/modules/tax-refund/use-tax-refund-mutations.ts",
];

const COSTS_MODULE_FILES = [
  "app/modules/CostsModule.tsx",
  "app/modules/costs/model.ts",
  "app/modules/costs/cost-form-drawer.tsx",
  "app/modules/costs/cost-filter-panel.tsx",
  "app/modules/costs/cost-table.tsx",
  "app/modules/costs/detail-drawers.tsx",
  "app/modules/costs/invoice-actions.tsx",
  "app/modules/costs/documents-drawer.tsx",
  "app/modules/costs/helpers.ts",
  "app/modules/costs/use-cost-document-actions.ts",
];

const LOGISTICS_FEES_MODULE_FILES = [
  "app/modules/LogisticsFeesModule.tsx",
  "app/modules/logistics-fees/model.ts",
  "app/modules/logistics-fees/bill-table.tsx",
  "app/modules/logistics-fees/delete-logistics-expense-action.ts",
  "app/modules/logistics-fees/details-actions.tsx",
  "app/modules/logistics-fees/details-drawer.tsx",
  "app/modules/logistics-fees/details-table.tsx",
  "app/modules/logistics-fees/expense-form.tsx",
  "app/modules/logistics-fees/expense-form-view.tsx",
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
  "app/modules/logistics-fees/module-create-form.tsx",
  "app/modules/logistics-fees/module-header.tsx",
  "app/modules/logistics-fees/monthly-summary.tsx",
  "app/modules/logistics-fees/statement-panel.tsx",
  "app/modules/logistics-fees/shared.tsx",
  "app/modules/logistics-fees/shared-csv.ts",
  "app/modules/logistics-fees/shared-currency.ts",
  "app/modules/logistics-fees/shared-drafts.ts",
  "app/modules/logistics-fees/shared-monthly-summary.tsx",
  "app/modules/logistics-fees/shared-order-helpers.ts",
  "app/modules/logistics-fees/shared-row-reconcile.ts",
  "app/modules/logistics-fees/shared-status.ts",
  "app/modules/logistics-fees/use-logistics-fees-bill-actions.ts",
  "app/modules/logistics-fees/use-logistics-fees-review-actions.ts",
  "app/modules/logistics-fees/use-logistics-fees-save-details-action.ts",
  "app/modules/logistics-fees/use-logistics-fees-workflow-actions.ts",
  "app/modules/logistics-fees/use-logistics-fees-statement.ts",
  "app/modules/logistics-fees/use-logistics-expense-drawer-state.ts",
  "app/modules/logistics-fees/use-logistics-expense-form-controller.ts",
];

const WORKSPACE_SHELL_FILES = [
  "app/WorkspaceShell.tsx",
  "app/WorkspaceModuleContent.tsx",
  "app/workspace-auth-helpers.ts",
];

const COMPONENT_FILES = [
  "app/components.tsx",
  "app/components/types.ts",
  "app/components/ui-primitives.tsx",
  "app/components/display.tsx",
  "app/components/dialogs.tsx",
  "app/components/file-preview.tsx",
  "app/components/dismissible-layer.tsx",
];

const REPORTS_MODULE_FILES = [
  "app/modules/ReportsModule.tsx",
  "app/modules/reports/model.ts",
  "app/modules/reports/report-rows.tsx",
];

const CUSTOMER_COMMUNICATION_MODULE_FILES = [
  "app/modules/CustomerCommunicationModule.tsx",
  "app/modules/customer-communication-drawer.tsx",
  "app/modules/customer-communication-types.ts",
];

const CUSTOMER_COMMUNICATION_SERVICE_FILES = [
  "lib/platform/customer-communications.ts",
];

const SHIPPING_DOCUMENTS_FILES = [
  "lib/platform/shipping-documents.ts",
  "lib/platform/shipping-documents-email.ts",
  "lib/platform/shipping-documents-notifications.ts",
  "lib/platform/shipping-documents-shared.ts",
];

const SUPPLIER_DOCUMENTS_MODULE_FILES = [
  "app/modules/SupplierDocumentsModule.tsx",
  "app/modules/supplier-documents/helpers.ts",
  "app/modules/supplier-documents/task-card.tsx",
  "app/modules/supplier-documents/types.ts",
];

const SHARED_CONSTANTS_FILES = [
  "lib/platform/shared-constants.ts",
  "lib/platform/shared-party-constants.ts",
  "lib/platform/shared-cost-constants.ts",
  "lib/platform/shared-background-tasks.ts",
  "lib/platform/shared-document-constants.ts",
  "lib/platform/shared-settings-constants.ts",
  "lib/platform/shared-auth-constants.ts",
  "lib/platform/shared-permission-data.ts",
  "lib/platform/settings-permission-labels.ts",
];

const SHARED_USERS_FILES = [
  "lib/platform/shared-users.ts",
  "lib/platform/shared-users-types.ts",
  "lib/platform/shared-users-bootstrap.ts",
  "lib/platform/shared-users-profile.ts",
  "lib/platform/shared-users-list.ts",
  "lib/platform/shared-users-registration.ts",
  "lib/platform/shared-users-admin.ts",
];

const SHARED_AUTH_FILES = [
  "lib/platform/shared-auth.ts",
  "lib/platform/shared-auth-actor.ts",
  "lib/platform/shared-auth-login.ts",
  "lib/platform/shared-auth-password.ts",
  "lib/platform/shared-auth-request.ts",
  "lib/platform/shared-auth-constants.ts",
];

const SHARED_BASE_UTILS_FILES = [
  "lib/platform/shared-base-utils.ts",
  "lib/platform/shared-base-errors.ts",
  "lib/platform/shared-base-input.ts",
  "lib/platform/shared-background-tasks.ts",
];

const SHARED_SERIALIZATION_FILES = [
  "lib/platform/shared-serialization.ts",
  "lib/platform/shared-serialization-costs.ts",
  "lib/platform/shared-serialization-documents.ts",
  "lib/platform/shared-serialization-parties.ts",
  "lib/platform/shared-serialization-types.ts",
];

const COST_RECORDS_QUERY_FILES = [
  "lib/platform/cost-records-queries.ts",
  "lib/platform/cost-records-query-list.ts",
  "lib/platform/cost-records-query-shared.ts",
  "lib/platform/cost-records-invoice-groups.ts",
  "lib/platform/cost-records-order-summaries.ts",
];

const COST_RECORDS_MUTATION_FILES = [
  "lib/platform/cost-records-mutations.ts",
  "lib/platform/cost-records-mutation-shared.ts",
  "lib/platform/cost-records-supplier-mutations.ts",
  "lib/platform/cost-records-payment-mutations.ts",
  "lib/platform/cost-records-logistics-mutations.ts",
];

const ORDER_DOCUMENTS_FILES = [
  "lib/platform/order-documents.ts",
  "lib/platform/order-documents-types.ts",
  "lib/platform/order-documents-list.ts",
  "lib/platform/order-documents-upload.ts",
  "lib/platform/order-documents-files.ts",
];

const TAX_REFUNDS_FILES = [
  "lib/platform/tax-refunds.ts",
  "lib/platform/tax-refunds-actions.ts",
  "lib/platform/tax-refunds-detail.ts",
  "lib/platform/tax-refunds-list.ts",
  "lib/platform/tax-refunds-package.ts",
  "lib/platform/tax-refunds-shared.ts",
];

const OCR_INTEGRATION_FILES = [
  "lib/platform/ocr-integration.ts",
  "lib/platform/ocr-integration-clients.ts",
  "lib/platform/ocr-integration-customs.ts",
  "lib/platform/ocr-integration-docmind.ts",
  "lib/platform/ocr-integration-parsing.ts",
  "lib/platform/ocr-integration-runtime.ts",
  "lib/platform/ocr-integration-shared.ts",
];

const CUSTOMS_DECLARATION_PARSER_FILES = [
  "lib/customs-declaration-parser.ts",
  "lib/customs-declaration-parser-shared.ts",
  "lib/customs-declaration-field-parser.ts",
  "lib/customs-declaration-item-parser.ts",
  "lib/customs-pdf-text-extractor.ts",
];

const SUPPLIER_DOCUMENT_REQUEST_FILES = [
  "lib/platform/supplier-document-requests.ts",
  "lib/platform/supplier-document-request-create.ts",
  "lib/platform/supplier-document-request-list.ts",
  "lib/platform/supplier-document-request-notice.ts",
  "lib/platform/supplier-document-request-serialization.ts",
  "lib/platform/supplier-document-request-template.ts",
  "lib/platform/supplier-document-request-types.ts",
  "lib/platform/supplier-document-request-upload.ts",
];

const NOTIFICATION_ENGINE_FILES = [
  "lib/platform/notification-engine.ts",
  "lib/platform/notification-definitions.ts",
  "lib/platform/notification-factory-purchase-order-definition.ts",
  "lib/platform/notification-helpers.ts",
  "lib/platform/notification-send.ts",
  "lib/platform/notification-settings.ts",
];

const WORKBENCH_TODOS_FILES = [
  "lib/platform/workbench-todos.ts",
  "lib/platform/workbench-todo-policy.ts",
  "lib/platform/workbench-todos-core.ts",
  "lib/platform/workbench-todos-sources.ts",
  "lib/platform/workbench-todo-rules.ts",
  "lib/platform/workbench-logistics-todos.ts",
  "lib/platform/workbench-order-todos.ts",
  "lib/platform/workbench-supplier-payment-todos.ts",
  "lib/platform/workbench-tax-profit-todos.ts",
  "lib/platform/workbench-todos-builders.ts",
  "lib/platform/workbench-todos-completed.ts",
  "lib/platform/workbench-todos-context.ts",
  "lib/platform/workbench-todos-owners.ts",
  "lib/platform/workbench-todos-types.ts",
  "lib/platform/workbench-todos-workflow-helpers.ts",
  "lib/platform/workbench-tracking-todos.ts",
];

const LOGISTICS_EXPENSE_WORKFLOW_FILES = [
  "lib/platform/logistics-expense-workflow.ts",
  "lib/platform/logistics-expense-workflow-core.ts",
  "lib/platform/logistics-expense-workflow-model.ts",
  "lib/platform/logistics-expense-workflow-loaders.ts",
  "lib/platform/logistics-expense-workflow-batch.ts",
  "lib/platform/logistics-expense-workflow-review.ts",
  "lib/platform/logistics-expense-workflow-review-helpers.ts",
  "lib/platform/logistics-expense-workflow-mutations.ts",
  "lib/platform/logistics-expense-workflow-invoice.ts",
];

const LOGISTICS_EXPENSE_ACCESS_FILES = [
  "lib/platform/logistics-expense-access.ts",
  "lib/platform/logistics-expense-access-model.ts",
  "lib/platform/logistics-expense-access-serialization.ts",
  "lib/platform/logistics-expense-access-relations.ts",
  "lib/platform/logistics-expense-access-permissions.ts",
  "lib/platform/logistics-expense-access-mutations.ts",
];

const PAYMENTS_MODULE_FILES = [
  "app/modules/PaymentsModule.tsx",
  "app/modules/payments/types.ts",
  "app/modules/payments/helpers.ts",
  "app/modules/payments/quick-payment-panel.tsx",
  "app/modules/payments/payment-table-rows.tsx",
  "app/modules/payments/payment-detail-drawer.tsx",
];

const ORDERS_SERVICE_FILES = [
  "lib/platform/orders-module.ts",
  "lib/platform/order-receivable-search.ts",
  "lib/platform/order-receivable-sort.ts",
  "lib/platform/order-salesperson-repair.ts",
  "lib/platform/orders-payments.ts",
];

const SHARED_TAX_COMPLETENESS_FILES = [
  "lib/platform/shared-tax-completeness.ts",
  "lib/platform/shared-tax-completeness-types.ts",
  "lib/platform/shared-tax-logistics-invoices.ts",
  "lib/platform/shared-tax-supplier-documents.ts",
];

const SHIPSGO_TRACKING_FILES = [
  "lib/platform/shipsgo-tracking.ts",
  "lib/platform/shipsgo-tracking-utils.ts",
  "lib/platform/shipsgo-tracking-mapping.ts",
  "lib/platform/shipsgo-tracking-mapper.ts",
  "lib/platform/shipsgo-tracking-mapping-helpers.ts",
  "lib/platform/shipsgo-control-tower.ts",
  "lib/platform/shipsgo-tracking-service.ts",
  "lib/platform/shipsgo-tracking-service-shared.ts",
  "lib/platform/shipsgo-tracking-create.ts",
  "lib/platform/shipsgo-tracking-operations.ts",
  "lib/platform/shipsgo-tracking-serializer.ts",
  "lib/platform/shipsgo-tracking-sync.ts",
  "lib/platform/shipsgo-tracking-timeline.ts",
];

const REPORT_SERVICE_FILES = [
  "lib/report-service.ts",
  "lib/report-service-export.ts",
  "lib/report-service-mappers.ts",
  "lib/report-service-query.ts",
  "lib/report-service-shared.ts",
];

const DOMESTIC_LOGISTICS_OPS_FILES = [
  "lib/platform/domestic-logistics-ops.ts",
  "lib/platform/domestic-logistics-ops-input.ts",
  "lib/platform/domestic-logistics-ops-shared.ts",
  "lib/platform/domestic-logistics-ops-status.ts",
];

const DOMESTIC_LOGISTICS_API_FILES = [
  "lib/platform/domestic-logistics-api.ts",
  ...DOMESTIC_LOGISTICS_OPS_FILES,
];

function readSources(files: string[]) {
  return [...new Set(files)].map((file) => readFileSync(file, "utf8")).join("\n");
}

export function readSettingsModuleSource() {
  return readSources([...SETTINGS_MODULE_FILES, ...readSourceTree("app/modules/settings")]);
}

export function readCostsModuleSource() {
  return readSources([...COSTS_MODULE_FILES, ...readSourceTree("app/modules/costs")]);
}

export function readLogisticsFeesModuleSource() {
  return readSources([...LOGISTICS_FEES_MODULE_FILES, ...readSourceTree("app/modules/logistics-fees")]);
}

export const readLogisticsFeesInvoiceSource = () => readSources(readSourcePrefix("app/modules/logistics-fees", [
  "invoice-group",
  "invoice-upload",
]));

export function readDomesticLogisticsModuleSource() {
  return readSources([...DOMESTIC_LOGISTICS_MODULE_FILES, ...readSourceTree("app/modules/domestic-logistics")]);
}

export function readTaxRefundModuleSource() {
  return readSources([...TAX_REFUND_MODULE_FILES, ...readSourceTree("app/modules/tax-refund")]);
}

export const readTaxRefundUploadSource = () => readSources(readSourcePrefix("app/modules/tax-refund", [
  "upload-card",
  "upload-components",
  "customs-upload-components",
  "supplier-upload-components",
]));

export const readWorkspaceShellSource = () => readSources([...WORKSPACE_SHELL_FILES, ...readSourceTree("app/workspace")]);
export const readComponentsSource = () => readSources([
  ...COMPONENT_FILES,
  ...readSourcePrefix("app/components", ["file-preview"]),
]);
export const readReportsModuleSource = () => readSources([...REPORTS_MODULE_FILES, ...readSourceTree("app/modules/reports")]);
export const readTrackingMapSource = () => readSources(readSourceTree("app/tracking-map"));
export const readCustomerCommunicationModuleSource = () => readSources([
  ...CUSTOMER_COMMUNICATION_MODULE_FILES,
  ...readSourcePrefix("app/modules", ["customer-communication", "use-customer-communication-manual-mark"]),
]);
export const readCustomerCommunicationServiceSource = () => readSources([
  ...CUSTOMER_COMMUNICATION_SERVICE_FILES,
  ...readSourcePrefix("lib/platform", ["customer-communication"]),
]);
export const readShippingDocumentsSource = () => readSources([
  ...SHIPPING_DOCUMENTS_FILES,
  ...readSourcePrefix("lib/platform", ["shipping-documents"]),
]);
export const readSupplierDocumentsModuleSource = () => readSources([...SUPPLIER_DOCUMENTS_MODULE_FILES, ...readSourceTree("app/modules/supplier-documents")]);
export const readSupplierDocumentRequestListSource = () => readSources([
  "lib/platform/supplier-document-request-list.ts",
  "lib/platform/supplier-document-request-serialization.ts",
  "lib/platform/supplier-document-request-types.ts",
]);
export const readSharedConstantsSource = () => readSources([
  ...SHARED_CONSTANTS_FILES,
  ...readSourcePrefix("lib/platform", ["shared-document"]),
]);
export const readSharedUsersSource = () => readSources(SHARED_USERS_FILES);
export const readSharedAuthSource = () => readSources(SHARED_AUTH_FILES);
export const readSharedBaseUtilsSource = () => readSources(SHARED_BASE_UTILS_FILES);
export const readSharedSerializationSource = () => readSources(SHARED_SERIALIZATION_FILES);
export const readCostRecordsQueriesSource = () => readSources([...COST_RECORDS_QUERY_FILES, ...readSourcePrefix("lib/platform", ["cost-records-query", "cost-records-invoice-group", "cost-records-order-summaries"])]);
export const readCostRecordsMutationsSource = () => readSources([...COST_RECORDS_MUTATION_FILES, ...readSourcePrefix("lib/platform", [
  "cost-records-mutation", "cost-records-module", "cost-records-supplier-mutations",
  "cost-records-payment-mutations", "cost-records-logistics-mutations", "cost-records-delete", "cost-records-restore",
  "cost-records-lifecycle",
])]);
export const readCostRecordsSharedSource = () => readSources(readSourcePrefix("lib/platform", [
  "cost-records-shared", "cost-records-idempotency",
]));
export const readOrderDocumentsSource = () => readSources([...ORDER_DOCUMENTS_FILES, ...readSourcePrefix("lib/platform", ["order-documents"])]);
export const readFileAssetsSource = () => readSources(readSourcePrefix("lib/platform", ["file-asset", "file-assets"]));
export const readTaxRefundsSource = () => readSources([...TAX_REFUNDS_FILES, ...readSourcePrefix("lib/platform", ["tax-refunds"])]);
export const readTaxRefundActionsSource = () => readSources([
  "lib/platform/tax-refunds-actions.ts",
  "lib/platform/tax-refunds-action-support.ts",
  "lib/platform/tax-refunds-status-actions.ts",
  "lib/platform/tax-refunds-commission-actions.ts",
]);
export const readTaxRefundSharedSource = () => readSources(readSourcePrefix("lib/platform", [
  "tax-refunds-shared", "tax-refunds-logistics", "tax-refunds-model",
]));
export const readOcrIntegrationSource = () => readSources([...OCR_INTEGRATION_FILES, ...readSourcePrefix("lib/platform", ["ocr-integration"])]);
export const readCustomsDeclarationParserSource = () => readSources([...CUSTOMS_DECLARATION_PARSER_FILES, ...readSourcePrefix("lib", ["customs-declaration", "customs-pdf"])]);
export const readSupplierDocumentRequestsSource = () => readSources([...SUPPLIER_DOCUMENT_REQUEST_FILES, ...readSourcePrefix("lib/platform", ["supplier-document-request"])]);
export const readRepairTaxRelationsSource = () => readSources(readSourcePrefix("lib/platform", ["repair-tax-relations"]));
export const readNotificationEngineSource = () => readSources([
  ...NOTIFICATION_ENGINE_FILES,
  ...readSourcePrefix("lib/platform", ["notification"]),
]);
export const readNotificationTemplatesSource = () => readSources(readSourcePrefix("lib/platform", [
  "notification-templates", "notification-logistics",
]));
export const readWorkbenchTodosSource = () => readSources([...WORKBENCH_TODOS_FILES, ...readSourcePrefix("lib/platform", ["workbench"])]);
export const readLogisticsExpenseWorkflowSource = () => readSources([...LOGISTICS_EXPENSE_WORKFLOW_FILES, ...readSourcePrefix("lib/platform", [
  "logistics-expense-workflow", "logistics-expense-review", "logistics-expense-invoice", "logistics-expense-payment",
])]);
export const readLogisticsExpenseAccessSource = () => readSources([...LOGISTICS_EXPENSE_ACCESS_FILES, ...readSourcePrefix("lib/platform", [
  "logistics-expense-access", "logistics-expense-bill-access", "logistics-expense-billing",
])]);
export const readLogisticsExpenseCostSource = () => readSources(readSourcePrefix("lib/platform", ["logistics-expense-cost"]));
export const readLogisticsExpensePaymentSource = () => readSources(readSourcePrefix("lib/platform", [
  "logistics-expense-payment", "logistics-expense-review-cost", "logistics-expense-workflow-review-helpers",
]));
export const readLogisticsExpenseQueriesSource = () => readSources(readSourcePrefix("lib/platform", [
  "logistics-expense-queries", "logistics-expense-query",
]));
export const readLogisticsExpenseInvoiceSource = () => readSources(["lib/platform/logistics-expense-invoice.ts", ...readSourcePrefix("lib/platform", ["logistics-expense-invoice"])]);
export const readSharedTaxCompletenessSource = () => readSources([...SHARED_TAX_COMPLETENESS_FILES, ...readSourcePrefix("lib/platform", ["shared-tax-completeness", "shared-tax-logistics-invoices", "shared-tax-supplier-documents"])]);
export const readSharedOrderCalculationsSource = () => readSources(readSourcePrefix("lib/platform", [
  "shared-order-calculations", "shared-order-calculation", "shared-order-collections", "shared-order-reminders",
]));
export const readShipsgoTrackingSource = () => readSources([...SHIPSGO_TRACKING_FILES, ...readSourcePrefix("lib/platform", ["shipsgo"])]);
export const readFreightowerTrackingSource = () => readSources(readSourcePrefix("lib/platform", ["freightower"]));
export const readLogisticsInvoiceValidationSource = () => readSources(readSourcePrefix("lib/platform", ["logistics-invoice-validation"]));
export const readLogisticsInvoiceNotificationOutboxSource = () => readSources(readSourcePrefix("lib/platform", [
  "logistics-invoice-notification-outbox", "logistics-invoice-outbox",
]));
export const readReportServiceSource = () => readSources(REPORT_SERVICE_FILES);
export const readDomesticLogisticsOpsSource = () => readSources(DOMESTIC_LOGISTICS_OPS_FILES);
export const readDomesticLogisticsApiSource = () => readSources([
  ...DOMESTIC_LOGISTICS_API_FILES,
  ...readSourcePrefix("lib/platform", ["domestic-logistics"]),
]);
export const readPaymentsModuleSource = () => readSources([...PAYMENTS_MODULE_FILES, ...readSourceTree("app/modules/payments")]);
export const readOrdersServiceSource = () => readSources([...ORDERS_SERVICE_FILES, ...readSourcePrefix("lib/platform", ["orders-module", "order-receivable", "order-salesperson", "orders-payments"])]);
export const readPaymentsServiceSource = () => readSources([
  "lib/platform/payments-module.ts",
  ...readSourcePrefix("lib/platform", ["payments", "payment-write"]),
]);
export const readBusinessEntitiesSource = () => readSources(readSourcePrefix("lib/platform", ["business-entity", "business-entities"]));
export const readProfitOverviewSource = () => readSources(readSourcePrefix("lib/platform", ["profit-overview", "business-overview"]));
export const readOrdersModuleSource = () => readSources(["app/modules/OrdersModule.tsx", ...readSourceTree("app/modules/orders")]);
export const readProfitModuleSource = () => readSources(["app/modules/ProfitModule.tsx", ...readSourceTree("app/modules/profit")]);
export const readDashboardModuleSource = () => readSources(["app/modules/DashboardModule.tsx", ...readSourceTree("app/modules/dashboard")]);
export const readAccountSettingsSource = () => readSources(["app/AccountSettings.tsx", ...readSourceTree("app/account-settings")]);
export const readSharedOrderSerializationSource = () => readSources([
  "lib/platform/shared-order-serialization-types.ts",
  "lib/platform/shared-order-list-serialization.ts",
  "lib/platform/shared-order-detail-serialization.ts",
  "lib/platform/shared-order-shipping-documents.ts",
  "lib/platform/shared-order-serialization-impl.ts",
]);

export function readWorkspaceStylesSource() {
  const shardDir = "app/styles/workspace-shell";
  const shards = readdirSync(shardDir)
    .filter((file) => file.endsWith(".module.css"))
    .sort()
    .map((file) => readFileSync(join(shardDir, file), "utf8"));

  return [readFileSync("app/WorkspaceShell.module.css", "utf8"), ...shards].join("\n");
}

export function readCssModuleGraphSource(filePath: string) {
  const visited = new Set<string>();

  const readRecursive = (entryPath: string): string => {
    const normalized = normalize(entryPath);
    if (visited.has(normalized)) return "";
    visited.add(normalized);

    const source = readFileSync(normalized, "utf8");
    const imports = [...source.matchAll(/composes:\s*[\w-]+\s+from\s+"([^"]+)"/g)]
      .map((match) => join(dirname(normalized), match[1]))
      .filter((importPath) => importPath.endsWith(".module.css"));

    return [source, ...imports.map((importPath) => readRecursive(importPath))]
      .filter(Boolean)
      .join("\n\n");
  };

  return readRecursive(filePath);
}
