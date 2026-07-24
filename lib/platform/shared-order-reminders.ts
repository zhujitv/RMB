import type { NumericLike } from "./shared-order-calculation-types";

type ReminderResult = {
  status: string;
  overdueDays: number;
};

export function calcReminderStatus({
  outstandingCny,
  dueDate,
  reminderDays,
}: {
  outstandingCny: number;
  dueDate?: Date | null;
  reminderDays?: NumericLike | null;
}): ReminderResult {
  if (outstandingCny <= 0) return { status: "已结清", overdueDays: 0 };
  if (!dueDate) return { status: "未到期", overdueDays: 0 };
  const today = new Date();
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const diff = Math.round((due.getTime() - todayDate.getTime()) / 86400000);
  if (diff < 0) return { status: "已逾期", overdueDays: Math.abs(diff) };
  if (diff <= Number(reminderDays || 0)) return { status: "即将到期", overdueDays: 0 };
  return { status: "未到期", overdueDays: 0 };
}
