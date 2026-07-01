import { prisma } from "../prisma";
import { startOfChinaDay } from "./workbench-todo-rules";
import { listWorkbenchTodos, type WorkbenchTodo } from "./workbench-todos";
import { sendSystemEmail } from "./system-email";
import { nonEmpty } from "./shared";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;

export type WorkbenchTodoReminderResult = {
  scanned: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
  logs: Array<{
    todoId: string;
    todoType: string;
    ownerUserId: string;
    ownerEmail: string;
    overdueDays: number;
    emailStatus: string;
    errorMessage?: string;
  }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_REMINDER_DAYS = 5;
const MULTI_OWNER_REMINDER_TODO_TYPES = new Set(["TAX_REFUND_READY_NOT_ARCHIVED"]);

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.nextwood.net").replace(/\/+$/, "");
}

function todoHref(todo: WorkbenchTodo) {
  const href = todo.action?.href || "/";
  if (/^https?:\/\//i.test(href)) return href;
  return `${appBaseUrl()}${href.startsWith("/") ? href : `/${href}`}`;
}

function overdueDaysForTodo(todo: WorkbenchTodo, today: Date) {
  if (!todo.dueAt) return 0;
  const due = new Date(todo.dueAt);
  if (Number.isNaN(due.getTime())) return 0;
  const dueDay = startOfChinaDay(due);
  return Math.floor((today.getTime() - dueDay.getTime()) / DAY_MS);
}

function reminderBody(todo: WorkbenchTodo, overdueDays: number) {
  return [
    "以下待办事项已逾期超过 5 天，请尽快处理。",
    "",
    `待办事项标题：${todo.title}`,
    `来源模块：${todo.module || "-"}`,
    `关联订单号：${todo.orderNo || "-"}`,
    `客户简称：${todo.customerShortName || "-"}`,
    `截止时间：${todo.dueAt ? new Date(todo.dueAt).toLocaleString("zh-CN", { hour12: false }) : "-"}`,
    `已逾期天数：${overdueDays}`,
    `处理入口：${todoHref(todo)}`,
  ].join("\n");
}

async function alreadyRemindedToday(todo: WorkbenchTodo, ownerUserId: string, reminderDate: Date) {
  const existing = await prisma.todoReminderLog.findUnique({
    where: {
      todoId_ownerUserId_reminderDate: {
        todoId: todo.id,
        ownerUserId,
        reminderDate,
      },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

function uniqueIds(values: Array<string | null | undefined>) {
  return values.map((value) => nonEmpty(value)).filter((value, index, arr) => value && arr.indexOf(value) === index);
}

function reminderOwnerUserIds(todo: WorkbenchTodo) {
  if (MULTI_OWNER_REMINDER_TODO_TYPES.has(todo.type)) {
    return uniqueIds([...(todo.ownerUserIds || []), todo.ownerUserId]);
  }
  return uniqueIds([todo.ownerUserId]);
}

export async function sendOverdueWorkbenchTodoReminders(actor: ActorLike, now = new Date()): Promise<WorkbenchTodoReminderResult> {
  const today = startOfChinaDay(now);
  const reminderDate = today;
  const { todos } = await listWorkbenchTodos(actor);
  const eligibleTodoOwners = todos
    .filter((todo) => todo.status === "pending")
    .map((todo) => ({ todo, overdueDays: overdueDaysForTodo(todo, today) }))
    .filter(({ overdueDays }) => overdueDays > OVERDUE_REMINDER_DAYS)
    .flatMap(({ todo, overdueDays }) => reminderOwnerUserIds(todo).map((ownerUserId) => ({ todo, overdueDays, ownerUserId })));
  const ownerIds = uniqueIds(eligibleTodoOwners.map(({ ownerUserId }) => ownerUserId));
  const owners = await prisma.user.findMany({
    where: {
      id: { in: ownerIds },
      isActive: true,
      approvalStatus: "APPROVED",
    },
    select: { id: true, email: true },
  });
  const ownerEmailById = new Map(owners.map((owner) => [owner.id, owner.email]));
  const result: WorkbenchTodoReminderResult = {
    scanned: todos.length,
    eligible: eligibleTodoOwners.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    logs: [],
  };
  for (const { todo, overdueDays, ownerUserId: rawOwnerUserId } of eligibleTodoOwners) {
    const ownerUserId = nonEmpty(rawOwnerUserId);
    if (!ownerUserId) continue;
    const ownerEmail = nonEmpty(ownerEmailById.get(ownerUserId));
    if (!ownerEmail) {
      if (!await alreadyRemindedToday(todo, ownerUserId, reminderDate)) {
        await prisma.todoReminderLog.create({
          data: {
            todoId: todo.id,
            todoType: todo.type,
            relatedOrderId: todo.orderId || null,
            ownerUserId,
            ownerEmail: "",
            remindedAt: now,
            reminderDate,
            overdueDays,
            emailStatus: "SKIPPED",
            errorMessage: "负责人邮箱为空或账号不可用",
          },
        });
      }
      result.skipped += 1;
      result.logs.push({
        todoId: todo.id,
        todoType: todo.type,
        ownerUserId,
        ownerEmail: "",
        overdueDays,
        emailStatus: "SKIPPED",
        errorMessage: "负责人邮箱为空或账号不可用",
      });
      continue;
    }
    if (await alreadyRemindedToday(todo, ownerUserId, reminderDate)) {
      result.skipped += 1;
      continue;
    }
    const baseLog = {
      todoId: todo.id,
      todoType: todo.type,
      relatedOrderId: todo.orderId || null,
      ownerUserId,
      ownerEmail,
      remindedAt: now,
      reminderDate,
      overdueDays,
    };
    try {
      await sendSystemEmail({
        recipientEmails: [ownerEmail],
        subject: "【NEXTWOOD ERP】待办事项已逾期超过 5 天",
        body: reminderBody(todo, overdueDays),
        idempotencyKey: `todo-reminder-${todo.id}-${ownerUserId}-${reminderDate.toISOString().slice(0, 10)}`,
      });
      await prisma.todoReminderLog.create({
        data: {
          ...baseLog,
          emailStatus: "SENT",
        },
      });
      result.sent += 1;
      result.logs.push({ todoId: todo.id, todoType: todo.type, ownerUserId, ownerEmail, overdueDays, emailStatus: "SENT" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.slice(0, 500) : "邮件发送失败";
      await prisma.todoReminderLog.create({
        data: {
          ...baseLog,
          emailStatus: "FAILED",
          errorMessage,
        },
      });
      result.failed += 1;
      result.logs.push({ todoId: todo.id, todoType: todo.type, ownerUserId, ownerEmail, overdueDays, emailStatus: "FAILED", errorMessage });
    }
  }
  return result;
}
