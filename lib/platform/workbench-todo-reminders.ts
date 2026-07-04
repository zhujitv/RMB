import { prisma } from "../prisma";
import { startOfChinaDay } from "./workbench-todo-rules";
import { planWorkbenchTodoReminderTargets } from "./workbench-todo-policy";
import { listWorkbenchTodos, type WorkbenchTodo } from "./workbench-todos";
import { NOTIFICATION_TEMPLATE_TYPES, sendNotificationEmail } from "./notification-engine";
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
  policySkipped: number;
  adminFallback: number;
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

function reminderVariables(todo: WorkbenchTodo, overdueDays: number) {
  return {
    ownerName: todo.ownerName || "-",
    todoTitle: todo.title || "-",
    module: todo.module || "-",
    orderNo: todo.orderNo || "-",
    customerShortName: todo.customerShortName || "-",
    dueAt: todo.dueAt ? new Date(todo.dueAt).toLocaleString("zh-CN", { hour12: false }) : "-",
    overdueDays: String(overdueDays),
    actionUrl: todoHref(todo),
  };
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

function uniqueReminderOwners<T extends { id: string }>(owners: T[]) {
  const seen = new Set<string>();
  return owners.filter((owner) => {
    if (seen.has(owner.id)) return false;
    seen.add(owner.id);
    return true;
  });
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
  const overdueTodoOwners = todos
    .filter((todo) => todo.status === "ACTIVE")
    .map((todo) => ({ todo, overdueDays: overdueDaysForTodo(todo, today) }))
    .filter(({ overdueDays }) => overdueDays > OVERDUE_REMINDER_DAYS)
    .flatMap(({ todo, overdueDays }) => reminderOwnerUserIds(todo).map((ownerUserId) => ({ todo, overdueDays, ownerUserId })));
  const ownerIds = uniqueIds(overdueTodoOwners.map(({ ownerUserId }) => ownerUserId));
  const [ownerUsers, adminUsers] = await Promise.all([
    ownerIds.length
      ? prisma.user.findMany({
          where: {
            id: { in: ownerIds },
            isActive: true,
            approvalStatus: "APPROVED",
          },
          select: { id: true, email: true, role: true },
          take: ownerIds.length,
        })
      : Promise.resolve([]),
    prisma.user.findMany({
      where: {
        role: "管理员",
        isActive: true,
        approvalStatus: "APPROVED",
      },
      select: { id: true, email: true, role: true },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
  ]);
  const owners = uniqueReminderOwners([...ownerUsers, ...adminUsers]);
  const {
    ownerById,
    eligibleTodoOwners,
    policySkippedTodoOwners,
    adminFallbackTodoOwners,
  } = planWorkbenchTodoReminderTargets(overdueTodoOwners, owners);
  const result: WorkbenchTodoReminderResult = {
    scanned: todos.length,
    eligible: eligibleTodoOwners.length,
    policySkipped: policySkippedTodoOwners.length,
    adminFallback: adminFallbackTodoOwners.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    logs: [],
  };
  const adminFallbackTodoIds = new Set(adminFallbackTodoOwners.map(({ todo }) => todo.id));
  const policySkippedMessage = (todo: WorkbenchTodo) => adminFallbackTodoIds.has(todo.id)
    ? "财务只接收退税归档逾期提醒，已转交管理员处理"
    : "财务只接收退税归档逾期提醒，未找到可接收的管理员账号";
  for (const { todo, overdueDays, ownerUserId: rawOwnerUserId } of policySkippedTodoOwners) {
    const ownerUserId = nonEmpty(rawOwnerUserId);
    if (!ownerUserId) continue;
    const owner = ownerById.get(ownerUserId);
    const ownerEmail = nonEmpty(owner?.email);
    const errorMessage = policySkippedMessage(todo);
    if (!await alreadyRemindedToday(todo, ownerUserId, reminderDate)) {
      await prisma.todoReminderLog.create({
        data: {
          todoId: todo.id,
          todoType: todo.type,
          relatedOrderId: todo.orderId || null,
          ownerUserId,
          ownerEmail,
          remindedAt: now,
          reminderDate,
          overdueDays,
          emailStatus: "SKIPPED",
          errorMessage,
        },
      });
    }
    result.logs.push({
      todoId: todo.id,
      todoType: todo.type,
      ownerUserId,
      ownerEmail,
      overdueDays,
      emailStatus: "SKIPPED",
      errorMessage,
    });
  }
  for (const { todo, overdueDays, ownerUserId: rawOwnerUserId } of eligibleTodoOwners) {
    const ownerUserId = nonEmpty(rawOwnerUserId);
    if (!ownerUserId) continue;
    const owner = ownerById.get(ownerUserId);
    const ownerEmail = nonEmpty(owner?.email);
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
      const delivery = await sendNotificationEmail({
        type: NOTIFICATION_TEMPLATE_TYPES.WORKBENCH_TODO_OVERDUE,
        recipientEmails: [ownerEmail],
        variables: reminderVariables(todo, overdueDays),
        idempotencyKey: `todo-reminder-${todo.id}-${ownerUserId}-${reminderDate.toISOString().slice(0, 10)}`,
        relatedEntityType: "workbench_todos",
        relatedEntityId: todo.id,
        relatedOrderId: todo.orderId || "",
        context: { todoType: todo.type, ownerUserId },
      });
      if (delivery.skipped || delivery.sent !== true) {
        const message = delivery.error || "Work Center 逾期待办提醒模板已停用";
        await prisma.todoReminderLog.create({
          data: {
            ...baseLog,
            emailStatus: "SKIPPED",
            errorMessage: message,
          },
        });
        result.skipped += 1;
        result.logs.push({ todoId: todo.id, todoType: todo.type, ownerUserId, ownerEmail, overdueDays, emailStatus: "SKIPPED", errorMessage: message });
        continue;
      }
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
