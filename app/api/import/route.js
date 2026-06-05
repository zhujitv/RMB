import { NextResponse } from "next/server";
import {
  costData,
  invoiceData,
  readLedger,
  receiptData,
} from "../../../lib/ledger-db";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const invoices = Array.isArray(body.invoices) ? body.invoices : [];
    const receipts = Array.isArray(body.receipts) ? body.receipts : [];
    const costs = Array.isArray(body.costs) ? body.costs : [];

    await prisma.$transaction([
      prisma.cost.deleteMany(),
      prisma.receipt.deleteMany(),
      prisma.invoice.deleteMany(),
      invoices.length
        ? prisma.invoice.createMany({ data: invoices.map(invoiceData) })
        : prisma.invoice.deleteMany({ where: { id: "__noop__" } }),
      receipts.length
        ? prisma.receipt.createMany({ data: receipts.map(receiptData) })
        : prisma.receipt.deleteMany({ where: { id: "__noop__" } }),
      costs.length
        ? prisma.cost.createMany({ data: costs.map(costData) })
        : prisma.cost.deleteMany({ where: { id: "__noop__" } }),
    ]);

    return NextResponse.json(await readLedger());
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "LEDGER_IMPORT_FAILED" },
      { status: 500 },
    );
  }
}
