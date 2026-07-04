import { LogisticsExpenseForm } from "./expense-form";

export function LogisticsFeesCreateForm({
  open,
  currentUserRole,
  currentUserSupplierId,
  onCancel,
  onSaved,
}: {
  open: boolean;
  currentUserRole: string;
  currentUserSupplierId: string;
  onCancel: () => void;
  onSaved: (message?: string) => void;
}) {
  if (!open) return null;
  return (
    <LogisticsExpenseForm
      currentUserRole={currentUserRole}
      currentUserSupplierId={currentUserSupplierId}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}
