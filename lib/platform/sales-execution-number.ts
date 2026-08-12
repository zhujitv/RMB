import type { Prisma } from "../generated/prisma/client.js";

function sequenceLetters(value: number) {
  let current = value;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result || "A";
}

function compactDate(value: Date) {
  return value.toISOString().slice(0, 10).replaceAll("-", "");
}

export async function allocateSalesExecutionNumber(client: Prisma.TransactionClient, executionDate: Date) {
  const sequence = await client.salesExecutionNumberSequence.upsert({
    where: { executionDate },
    update: { lastSequence: { increment: 1 } },
    create: { executionDate, lastSequence: 1 },
  });
  return `SE-${compactDate(executionDate)}-${sequenceLetters(sequence.lastSequence)}`;
}

export function factoryPurchaseOrderNumber(executionNo: string, sequenceNo: number) {
  const base = executionNo.startsWith("SE-") ? `PO-${executionNo.slice(3)}` : `PO-${executionNo}`;
  return `${base}-${String(sequenceNo).padStart(2, "0")}`;
}
