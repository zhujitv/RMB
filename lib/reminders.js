import { readLedger } from "./ledger-db";

function numberFromInput(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function itemCny(item) {
  return numberFromInput(item.amount) * numberFromInput(item.rate || 1);
}

function parseDateOnly(value) {
  const parts = String(value || "")
    .split("-")
    .map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [year, month, day] = parts;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = parseDateOnly(dateString);
  const dayCount = Number(days);
  if (!date || !Number.isFinite(dayCount)) return "";
  date.setUTCDate(date.getUTCDate() + Math.round(dayCount));
  return formatDateOnly(date);
}

function diffDays(dateString, baseString = today()) {
  const date = parseDateOnly(dateString);
  const base = parseDateOnly(baseString);
  if (!date || !base) return Number.POSITIVE_INFINITY;
  return Math.round((date.getTime() - base.getTime()) / 86400000);
}

function confirmedReceipts(receipts) {
  return receipts.filter((item) => item.status !== "待确认");
}

function sumByOrder(items) {
  return items.reduce((map, item) => {
    const key = item.orderNo || "未填写订单";
    map.set(key, (map.get(key) || 0) + itemCny(item));
    return map;
  }, new Map());
}

function getCreditDays(item) {
  if (item.creditDays === undefined || item.creditDays === null || item.creditDays === "") return "";
  const days = Number(item.creditDays);
  return Number.isFinite(days) && days >= 0 ? Math.round(days) : "";
}

function getDueDate(item) {
  const creditDays = getCreditDays(item);
  return item.dueDate || (creditDays === "" ? "" : addDays(item.date, creditDays));
}

function getReminderDays(item) {
  const days = Number(item.reminderDays);
  return Number.isFinite(days) && days >= 0 ? Math.round(days) : 7;
}

function getReminderTarget(item) {
  return item.reminderTarget || "财务和业务员";
}

function reminderText(daysLeft) {
  if (daysLeft < 0) return `逾期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天到期";
  return `${daysLeft} 天后到期`;
}

export async function readPaymentReminders() {
  const ledger = await readLedger();
  const receivedByOrder = sumByOrder(confirmedReceipts(ledger.receipts));

  return ledger.invoices
    .map((invoice) => {
      const received = receivedByOrder.get(invoice.orderNo || "未填写订单") || 0;
      const outstanding = itemCny(invoice) - received;
      const dueDate = getDueDate(invoice);
      const daysLeft = diffDays(dueDate);
      const reminderDays = getReminderDays(invoice);

      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        orderNo: invoice.orderNo,
        blNo: invoice.blNo,
        customer: invoice.customer,
        salesperson: invoice.salesperson,
        dueDate,
        daysLeft,
        reminderDays,
        reminderTarget: getReminderTarget(invoice),
        outstanding,
        status: reminderText(daysLeft),
      };
    })
    .filter(
      (item) =>
        item.outstanding > 0.005 &&
        item.dueDate &&
        item.daysLeft <= item.reminderDays,
    )
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function reminderMessage(reminders) {
  if (!reminders.length) return "今日暂无到期或即将到期的催款提醒。";

  return [
    `外贸收款催款提醒：${reminders.length} 条`,
    ...reminders.map(
      (item) =>
        `${item.status}｜订单 ${item.orderNo}｜提单 ${item.blNo || "未填"}｜客户 ${item.customer}｜未收 ¥${item.outstanding.toFixed(2)}｜提醒 ${item.reminderTarget}｜业务员 ${item.salesperson || "未填"}`,
    ),
  ].join("\n");
}
