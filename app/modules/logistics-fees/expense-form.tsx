import { LogisticsExpenseFormView } from "./expense-form-view";
import type { ExpenseOrderOption } from "./model";
import { useLogisticsExpenseFormController } from "./use-logistics-expense-form-controller";

export function LogisticsExpenseForm({
  onCancel,
  onSaved,
  initialOrder,
  currentUserRole = "",
  currentUserSupplierId = "",
}: {
  onCancel: () => void;
  onSaved: (message?: string) => void;
  initialOrder?: Partial<ExpenseOrderOption> | null;
  currentUserRole?: string;
  currentUserSupplierId?: string;
}) {
  const controller = useLogisticsExpenseFormController({
    onSaved,
    initialOrder,
    currentUserRole,
    currentUserSupplierId,
  });

  return (
    <LogisticsExpenseFormView
      form={controller.form}
      message={controller.message}
      saving={controller.saving}
      selectedOrder={controller.selectedOrder}
      selectedSupplier={controller.selectedSupplier}
      isLockedSupplier={controller.isLockedSupplier}
      supplierSummaryText={controller.supplierSummaryText}
      supplierAllowedCostTypes={controller.supplierAllowedCostTypes}
      costTypeOptions={controller.costTypeOptions}
      formCurrencySummary={controller.formCurrencySummary}
      searchOrders={controller.searchOrders}
      searchSuppliers={controller.searchSuppliers}
      onOrderSelect={controller.handleOrderSelect}
      onSupplierSelect={controller.handleSupplierSelect}
      onItemCostTypeChange={controller.handleItemCostTypeChange}
      onItemCurrencyChange={controller.handleItemCurrencyChange}
      onItemFieldChange={controller.setItemField}
      onAddItem={controller.addExpenseItem}
      onRemoveItem={controller.removeExpenseItem}
      onSubmitExpense={controller.submitExpense}
      onCancel={onCancel}
    />
  );
}
