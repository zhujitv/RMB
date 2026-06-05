import { prisma } from "./prisma";

function dateFromInput(value) {
  const fallback = new Date().toISOString().slice(0, 10);
  return new Date(`${value || fallback}T00:00:00.000Z`);
}

function dateToInput(value) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

function idFromInput(value) {
  return value || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalInt(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function numberFromInput(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function withoutId(data) {
  const { id, ...rest } = data;
  return rest;
}

export function serializeInvoice(row) {
  return {
    id: row.id,
    date: dateToInput(row.invoiceDate),
    invoiceNo: row.invoiceNo || "",
    orderNo: row.orderNo,
    blNo: row.blNo || "",
    salesperson: row.salesperson || "",
    customer: row.customer,
    country: row.country || "",
    currency: row.currency,
    amount: Number(row.amount),
    rate: Number(row.rate),
    creditDays: row.creditDays ?? "",
    dueDate: dateToInput(row.dueDate),
    reminderDays: row.reminderDays,
    reminderTarget: row.reminderTarget,
    note: row.note || "",
  };
}

export function serializeReceipt(row) {
  return {
    id: row.id,
    date: dateToInput(row.receiptDate),
    orderNo: row.orderNo,
    customer: row.customer,
    country: row.country || "",
    currency: row.currency,
    amount: Number(row.amount),
    rate: Number(row.rate),
    status: row.status,
    note: row.note || "",
  };
}

export function serializeCost(row) {
  return {
    id: row.id,
    date: dateToInput(row.costDate),
    orderNo: row.orderNo,
    type: row.type,
    payee: row.payee,
    currency: row.currency,
    amount: Number(row.amount),
    rate: Number(row.rate),
    status: row.status,
    note: row.note || "",
  };
}

export function invoiceData(input) {
  const now = new Date();
  return {
    id: idFromInput(input.id),
    invoiceDate: dateFromInput(input.date),
    invoiceNo: optionalText(input.invoiceNo),
    orderNo: String(input.orderNo || "").trim(),
    blNo: optionalText(input.blNo),
    salesperson: optionalText(input.salesperson),
    customer: String(input.customer || "").trim(),
    country: optionalText(input.country),
    currency: input.currency || "USD",
    amount: numberFromInput(input.amount),
    rate: numberFromInput(input.rate, 1),
    creditDays: optionalInt(input.creditDays),
    dueDate: input.dueDate ? dateFromInput(input.dueDate) : null,
    reminderDays: numberFromInput(input.reminderDays, 7),
    reminderTarget: input.reminderTarget || "财务和业务员",
    note: optionalText(input.note),
    updatedAt: now,
  };
}

export function receiptData(input) {
  const now = new Date();
  return {
    id: idFromInput(input.id),
    receiptDate: dateFromInput(input.date),
    orderNo: String(input.orderNo || "").trim(),
    customer: String(input.customer || "").trim(),
    country: optionalText(input.country),
    currency: input.currency || "USD",
    amount: numberFromInput(input.amount),
    rate: numberFromInput(input.rate, 1),
    status: input.status || "已到账",
    note: optionalText(input.note),
    updatedAt: now,
  };
}

export function costData(input) {
  const now = new Date();
  return {
    id: idFromInput(input.id),
    costDate: dateFromInput(input.date),
    orderNo: String(input.orderNo || "").trim(),
    type: input.type || "货款",
    payee: String(input.payee || "").trim(),
    currency: input.currency || "CNY",
    amount: numberFromInput(input.amount),
    rate: numberFromInput(input.rate, 1),
    status: input.status || "已支付",
    note: optionalText(input.note),
    updatedAt: now,
  };
}

export async function readLedger() {
  const [invoices, receipts, costs] = await Promise.all([
    prisma.invoice.findMany({ orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }] }),
    prisma.receipt.findMany({ orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }] }),
    prisma.cost.findMany({ orderBy: [{ costDate: "desc" }, { createdAt: "desc" }] }),
  ]);

  return {
    invoices: invoices.map(serializeInvoice),
    receipts: receipts.map(serializeReceipt),
    costs: costs.map(serializeCost),
  };
}

export async function upsertInvoice(input) {
  const data = invoiceData(input);
  const row = await prisma.invoice.upsert({
    where: { id: data.id },
    create: data,
    update: withoutId(data),
  });
  return serializeInvoice(row);
}

export async function upsertReceipt(input) {
  const data = receiptData(input);
  const row = await prisma.receipt.upsert({
    where: { id: data.id },
    create: data,
    update: withoutId(data),
  });
  return serializeReceipt(row);
}

export async function upsertCost(input) {
  const data = costData(input);
  const row = await prisma.cost.upsert({
    where: { id: data.id },
    create: data,
    update: withoutId(data),
  });
  return serializeCost(row);
}

export async function deleteInvoice(id) {
  await prisma.invoice.deleteMany({ where: { id } });
}

export async function deleteReceipt(id) {
  await prisma.receipt.deleteMany({ where: { id } });
}

export async function deleteCost(id) {
  await prisma.cost.deleteMany({ where: { id } });
}
