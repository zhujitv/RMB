import { readFileSync } from "node:fs";
import { readCostRecordsMutationsSource, readCostRecordsQueriesSource, readCostsModuleSource, readDomesticLogisticsModuleSource, readLogisticsExpenseAccessSource, readLogisticsExpenseWorkflowSource, readLogisticsFeesModuleSource, readNotificationEngineSource, readProfitModuleSource, readReportsModuleSource, readSettingsModuleSource, readSharedConstantsSource, readSharedSerializationSource, readSharedTaxCompletenessSource, readSharedUsersSource, readTaxRefundsSource, readWorkspaceShellSource, readWorkspaceStylesSource } from "./source-helpers.ts";

export const backend = [
  readFileSync("lib/platform/logistics-cost-types.ts", "utf8"),
  readSharedConstantsSource(),
  readFileSync("lib/platform/shared-tax.ts", "utf8"),
  readSharedTaxCompletenessSource(),
  readFileSync("lib/platform/shared-tax-sync.ts", "utf8"),
  readFileSync("lib/platform/shared-order-summary.ts", "utf8"),
  readFileSync("lib/platform/shared-order-calculations.ts", "utf8"),
  readFileSync("lib/platform/commission-formula.ts", "utf8"),
  readFileSync("lib/platform/shared-order-serialization-impl.ts", "utf8"),
  readSharedSerializationSource(),
  readFileSync("lib/platform/shared-order-relations.ts", "utf8"),
  readSharedUsersSource(),
  readFileSync("lib/platform/masters-access.ts", "utf8"),
  readFileSync("lib/platform/cost-records.ts", "utf8"),
  readFileSync("lib/platform/cost-records-shared.ts", "utf8"),
  readCostRecordsQueriesSource(),
  readCostRecordsMutationsSource(),
  readFileSync("lib/platform/logistics-expenses.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-shared.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-access.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-access-model.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-cost-payment.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-cost-safety.ts", "utf8"),
  readLogisticsExpenseAccessSource(),
  readFileSync("lib/platform/logistics-expense-access-permissions.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-access-mutations.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-invoice.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-invoice-documents.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-core.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-basic-mutations.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-detail-mutations.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-review.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-review-helpers.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-mutations.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-workflow-invoice.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-invoice-notifications.ts", "utf8"),
  readFileSync("lib/platform/notification-templates.ts", "utf8"),
  readNotificationEngineSource(),
  readFileSync("lib/platform/logistics-invoice-groups.ts", "utf8"),
  readFileSync("lib/platform/logistics-invoice-amount-parser.ts", "utf8"),
  readFileSync("lib/platform/logistics-invoice-validation-rules.ts", "utf8"),
  readFileSync("lib/platform/logistics-invoice-validation.ts", "utf8"),
  readFileSync("lib/platform/logistics-bill-state-machine.ts", "utf8"),
  readFileSync("lib/platform/logistics-expense-queries.ts", "utf8"),
  readLogisticsExpenseWorkflowSource(),
  readFileSync("lib/platform/profit-overview.ts", "utf8"),
  readTaxRefundsSource(),
].join("\n");
export const schema = readFileSync("prisma/schema.prisma", "utf8");
export const menuFile = readFileSync("app/menu.ts", "utf8");
export const workspaceShell = readWorkspaceShellSource();
export const supplierMasters = readFileSync(
  "lib/platform/supplier-masters.ts",
  "utf8",
);
export const migration = readFileSync(
  "prisma/migrations/20260612190000_logistics_expense_workflow/migration.sql",
  "utf8",
);
export const containerCountMigration = readFileSync(
  "prisma/migrations/20260622100000_logistics_expense_container_count/migration.sql",
  "utf8",
);
export const invoiceNotificationMigration = readFileSync(
  "prisma/migrations/20260622233000_logistics_expense_invoice_notification/migration.sql",
  "utf8",
);
export const invoiceGroupMigration = readFileSync(
  "prisma/migrations/20260623073000_logistics_invoice_group_uploads/migration.sql",
  "utf8",
);
export const removeInvoiceManualFieldsMigration = readFileSync(
  "prisma/migrations/20260623194500_remove_logistics_invoice_manual_fields/migration.sql",
  "utf8",
);
export const logisticsBillMigration = readFileSync(
  "prisma/migrations/20260624103000_logistics_bills/migration.sql",
  "utf8",
);
export const logisticsInvoiceUsdGroupingMigration = readFileSync(
  "prisma/migrations/20260626235000_fix_logistics_invoice_usd_grouping/migration.sql",
  "utf8",
);
export const logisticsBillConvergenceMigration = readFileSync(
  "prisma/migrations/20260627120000_converge_logistics_expense_status_to_bills/migration.sql",
  "utf8",
);
export const logisticsBillSupplierKeyMigration = readFileSync(
  "prisma/migrations/20260705143000_logistics_bill_supplier_key/migration.sql",
  "utf8",
);
export const logisticsBillVoidMigration = readFileSync(
  "prisma/migrations/20260707160000_logistics_bill_void_status/migration.sql",
  "utf8",
);
export const logisticsReviewInvoicePaymentMigration = readFileSync(
  "prisma/migrations/20260716090000_decouple_logistics_review_invoice_payment/migration.sql",
  "utf8",
);
export const logisticsBillStateMachine = readFileSync(
  "lib/platform/logistics-bill-state-machine.ts",
  "utf8",
);
export const logisticsFeesMain = readLogisticsFeesModuleSource();
export const logisticsFeesBillActions = readFileSync(
  "app/modules/logistics-fees/use-logistics-fees-bill-actions.ts",
  "utf8",
)
  + "\n"
  + [
    "app/modules/logistics-fees/use-logistics-fees-review-actions.ts",
    "app/modules/logistics-fees/use-logistics-fees-save-details-action.ts",
    "app/modules/logistics-fees/use-logistics-fees-workflow-actions.ts",
  ].map((file) => readFileSync(file, "utf8")).join("\n");
export const logisticsFeesDeleteAction = readFileSync(
  "app/modules/logistics-fees/delete-logistics-expense-action.ts",
  "utf8",
);
export const logisticsFeesModel = readFileSync(
  "app/modules/logistics-fees/model.ts",
  "utf8",
);
export const logisticsFeesDetails = [
  "app/modules/logistics-fees/details-drawer.tsx",
  "app/modules/logistics-fees/details-table.tsx",
  "app/modules/logistics-fees/details-actions.tsx",
  "app/modules/logistics-fees/use-logistics-expense-drawer-state.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
export const logisticsFeesForm = [
  "app/modules/logistics-fees/expense-form.tsx",
  "app/modules/logistics-fees/expense-form-view.tsx",
  "app/modules/logistics-fees/use-logistics-expense-form-controller.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
export const logisticsFeesInvoices = readFileSync(
  "app/modules/logistics-fees/invoice-groups-panel.tsx",
  "utf8",
);
export const logisticsFeesShared = [
  "app/modules/logistics-fees/shared.tsx",
  "app/modules/logistics-fees/shared-csv.ts",
  "app/modules/logistics-fees/shared-currency.ts",
  "app/modules/logistics-fees/shared-drafts.ts",
  "app/modules/logistics-fees/shared-monthly-summary.tsx",
  "app/modules/logistics-fees/shared-order-helpers.ts",
  "app/modules/logistics-fees/shared-row-reconcile.ts",
  "app/modules/logistics-fees/shared-status-core.ts",
  "app/modules/logistics-fees/shared-status-bill.ts",
  "app/modules/logistics-fees/shared-status.ts",
].map((file) => readFileSync(file, "utf8")).join("\n");
export const logisticsFeesBillTable = readFileSync(
  "app/modules/logistics-fees/bill-table.tsx",
  "utf8",
);
export const logisticsFeesMonthlySummary = readFileSync(
  "app/modules/logistics-fees/monthly-summary.tsx",
  "utf8",
);
export const logisticsModule = readLogisticsFeesModuleSource();
export const domesticLogisticsApiSource = readFileSync(
  "lib/platform/domestic-logistics-api.ts",
  "utf8",
);
export const deleteExpenseSource =
  logisticsFeesDeleteAction.match(
    /async function deleteExpense[\s\S]*?\n\n  return deleteExpense/,
  )?.[0] || "";
export const withdrawExpenseSource =
  logisticsFeesBillActions.match(
    /async function withdrawExpense[\s\S]*?\n  async function submitDraftExpenseBill/,
  )?.[0] || "";
export const saveBillDetailsSource =
  logisticsFeesBillActions.match(
    /async function saveBillDetails[\s\S]*?\n  async function withdrawExpense/,
  )?.[0] || "";
export const frontendAggregateStatusSource =
  logisticsFeesShared.match(
    /export function aggregateClientLogisticsExpenseStatus[\s\S]*?\n}\n(?=\nexport function|\nexport \*)/,
  )?.[0] || "";
export const logisticsExpenseDetailLineSource = readFileSync(
  "app/modules/logistics-fees/details-table.tsx",
  "utf8",
);
export const logisticsExpenseFormSource = logisticsFeesForm;
export const invoiceUploadFormSource =
  logisticsFeesInvoices.match(
    /function InvoiceUploadForm[\s\S]*?\n}\s*$/,
  )?.[0] || "";
export const monthlySummaryComponentSource =
  logisticsFeesShared.match(
    /export function MonthlySummaryComponent[\s\S]*?\n}\n\nexport function buildMonthlySummary/,
  )?.[0] || "";
export const supplierSectionComponentSource =
  logisticsFeesShared.match(
    /export function SupplierSectionComponent[\s\S]*?\n}\n\nexport function StatusPill/,
  )?.[0] || "";
export const billTableComponentSource =
  logisticsFeesBillTable.match(
    /function LogisticsExpenseBillTable[\s\S]*?\n}\n\nfunction LogisticsExpenseCompactRow/,
  )?.[0] || "";
export const backendAggregateStatusSource =
  backend.match(
    /export function aggregateLogisticsExpenseStatus[\s\S]*?\n}\n\nexport function logisticsExpenseBillAuditStatus/,
  )?.[0] || "";
export const submitLogisticsExpenseBillSource =
  readFileSync("lib/platform/logistics-expense-workflow-basic-mutations.ts", "utf8").match(
    /export async function submitLogisticsExpenseBill[\s\S]*?\n}\n(?=\nexport async function|\s*$)/,
  )?.[0] || "";
export const reviewLogisticsExpenseBillsSource = readFileSync(
  "lib/platform/logistics-expense-workflow-review.ts",
  "utf8",
) + "\n" + readFileSync("lib/platform/logistics-expense-workflow-review-helpers.ts", "utf8");
export const reviewLogisticsExpenseBillsFunctionSource =
  readFileSync("lib/platform/logistics-expense-workflow-review.ts", "utf8").match(
    /export async function reviewLogisticsExpenseBills[\s\S]*?\n}\n(?=\n\nexport async function|\s*$)/,
  )?.[0] || "";
export const approveLogisticsExpenseBillRowsSource =
  backend.match(
    /export async function approveLogisticsExpenseBillRowsInTransaction[\s\S]*?\n}\n\nexport async function updateLogisticsExpenseCostIds/,
  )?.[0] || "";
export const updateLogisticsExpensePaymentStatusSource =
  backend.match(
    /export async function updateLogisticsExpensePaymentStatus[\s\S]*?\n}\n\n/,
  )?.[0] || "";
export const reverseLogisticsExpensePaymentSource =
  backend.match(
    /export async function reverseLogisticsExpensePayment[\s\S]*?\n}\n(?=\nexport async function|\s*$)/,
  )?.[0] || "";
export const logisticsCostRoute = readFileSync(
  "app/api/logistics-costs/[id]/route.ts",
  "utf8",
);
export const logisticsInvoiceRoute = readFileSync(
  "app/api/logistics-costs/[id]/invoice/route.ts",
  "utf8",
);
export const logisticsReviewRoute = readFileSync(
  "app/api/logistics-costs/review/route.ts",
  "utf8",
);
export const notificationTemplateRoute = readFileSync(
  "app/api/settings/notification-templates/route.ts",
  "utf8",
);
export const logisticsExpenseDeleteRoute = readFileSync(
  "app/api/logistics-expenses/[id]/route.ts",
  "utf8",
);
export const logisticsExpenseBatchRoute = readFileSync(
  "app/api/logistics-expenses/batch-update/route.ts",
  "utf8",
);
export const logisticsExpenseBatchSaveRoute = readFileSync(
  "app/api/logistics-expenses/batch-save/route.ts",
  "utf8",
);
export const profitModule = readProfitModuleSource();
export const domesticLogisticsModule = readDomesticLogisticsModuleSource();
export const settingsModule = readSettingsModuleSource();
export const settingsModuleMain = settingsModule;
export const notificationTemplateCardSource =
  settingsModule.match(
    /export function NotificationTemplateSettingsCard[\s\S]*?\n}\n/,
  )?.[0] || "";
export const saveNotificationTemplateSource =
  settingsModuleMain.match(
    /async function saveNotificationTemplateSettings[\s\S]*?\n\n  return \(/,
  )?.[0] || "";
export const notificationTemplateFormSource =
  settingsModule.match(
    /export function notificationTemplateFormFromSettings[\s\S]*?\n}\n/,
  )?.[0] || "";
export const costsModule = readCostsModuleSource();
export const reportsModule = readReportsModuleSource();
export const workspaceStyles = readWorkspaceStylesSource();
export const logisticsExpenseQueries = readFileSync(
  "lib/platform/logistics-expense-queries.ts",
  "utf8",
);
export const listLogisticsExpensesSource =
  logisticsExpenseQueries.match(
    /export async function listLogisticsExpenses[\s\S]*?\n}\n\nfunction logisticsExpenseBillListWhere/,
  )?.[0] || "";
export const logisticsSupplierStatementSource =
  logisticsExpenseQueries.match(
    /export async function logisticsSupplierStatement[\s\S]*?\n}\n\nfunction logisticsPaymentLedgerRow/,
  )?.[0] || "";
