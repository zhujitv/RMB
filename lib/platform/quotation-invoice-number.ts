import type { Prisma } from "../generated/prisma/client.js";

function normalizedInvoiceDate(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError("Invalid quotation invoice date");
  }
  const dateKey = value.toISOString().slice(0, 10);
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function quotationInvoiceSuffix(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError("Quotation invoice sequence must be a non-negative safe integer");
  }
  if (sequence === 0) return "";

  let remaining = sequence;
  let suffix = "";
  while (remaining > 0) {
    remaining -= 1;
    suffix = String.fromCharCode(65 + (remaining % 26)) + suffix;
    remaining = Math.floor(remaining / 26);
  }
  return suffix;
}

export function formatQuotationInvoiceNumber(invoiceDate: Date, sequence: number) {
  const dateKey = normalizedInvoiceDate(invoiceDate).toISOString().slice(0, 10).replaceAll("-", "");
  return `${dateKey}${quotationInvoiceSuffix(sequence)}`;
}

export async function allocateQuotationInvoiceNumber(
  client: Prisma.TransactionClient,
  invoiceDate: Date,
) {
  const normalizedDate = normalizedInvoiceDate(invoiceDate);
  // This shape is translated to PostgreSQL INSERT ... ON CONFLICT. The update
  // increment and returned value therefore form one atomic allocation step.
  const sequence = await client.salesQuotationInvoiceSequence.upsert({
    where: { invoiceDate: normalizedDate },
    create: { invoiceDate: normalizedDate, lastSequence: 0 },
    update: { lastSequence: { increment: 1 } },
    select: { lastSequence: true },
  });
  return formatQuotationInvoiceNumber(normalizedDate, sequence.lastSequence);
}
