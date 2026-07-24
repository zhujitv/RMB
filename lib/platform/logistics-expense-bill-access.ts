import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client.js";
import {
  LOGISTICS_EXPENSE_AUDIT_STATUSES,
  codedError,
  dateFromInput,
  nonEmpty,
  permissionError,
} from "./shared";
import {
  includeLogisticsExpenseRelations,
  logisticsExpenseBillKey,
  logisticsExpenseBillOfLadingNo,
  logisticsExpenseLegacyBillKey,
} from "./logistics-expense-access-serialization";
import { logisticsExpenseAccessWhere } from "./logistics-expense-access-permissions";
import {
  type LogisticsActor,
  type LogisticsExpenseOrderForAccess,
  type LogisticsSupplierForExpense,
  type UnknownRecord,
  logisticsExpenseActorId,
} from "./logistics-expense-access-model";
import { assertBusinessNotArchived } from "./business-archive";

const LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES = [
  "待开票",
  "未通知",
  "已通知开票",
  "通知失败",
  "待开票 / 通知失败",
];

const LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES = ["待开票", "未付款"];

type LogisticsExpenseBillWriteDb = Prisma.TransactionClient | typeof prisma;

async function updateAppendableLogisticsExpenseBill(
  db: LogisticsExpenseBillWriteDb,
  billId: string,
  actor: LogisticsActor,
  auditStatus: string,
  submittedAt: unknown,
  now: Date,
  extraData: Prisma.LogisticsBillUncheckedUpdateManyInput = {},
) {
  await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "logistics_bills"
    WHERE "id" = ${billId}
    FOR UPDATE
  `);
  const current = await db.logisticsBill.findUnique({ where: { id: billId } });
  if (!current) {
    throw codedError("物流费用账单状态已变化，请刷新后重试。", 409, "LOGISTICS_BILL_APPEND_STATE_CHANGED");
  }
  if (current.status === "voided") {
    throw codedError("该订单/供应商对应物流费用账单已作废，不能继续追加费用，请重新核对订单后创建新账单。", 400, "LOGISTICS_BILL_VOIDED_CREATE_BLOCKED");
  }
  if (
    !["草稿", "已驳回"].includes(current.auditStatus)
    || !LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES.includes(current.invoiceStatus)
    || !LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES.includes(current.paymentStatus)
  ) {
    throw codedError("该订单/供应商已有进入审核、发票或付款流程的物流费用账单，不能继续追加明细。", 409, "LOGISTICS_BILL_APPEND_STATE_BLOCKED");
  }
  const updated = await db.logisticsBill.updateMany({
    where: {
      id: billId,
      status: { not: "voided" },
      auditStatus: { in: ["草稿", "已驳回"] },
      invoiceStatus: { in: LOGISTICS_BILL_APPENDABLE_INVOICE_STATUSES },
      paymentStatus: { in: LOGISTICS_BILL_APPENDABLE_PAYMENT_STATUSES },
    },
    data: {
      ...extraData,
      deletedAt: null,
      updatedById: logisticsExpenseActorId(actor) || null,
      ...(auditStatus === "待审核" ? {
        auditStatus,
        submittedAt: dateFromInput(submittedAt) || now,
        submittedById: logisticsExpenseActorId(actor) || null,
        rejectReason: null,
        invoiceNotificationError: null,
      } : {}),
    },
  });
  if (updated.count !== 1) {
    throw codedError("物流费用账单状态已变化，新增明细已取消，请刷新后重试。", 409, "LOGISTICS_BILL_APPEND_STATE_CHANGED");
  }
  return db.logisticsBill.findUniqueOrThrow({ where: { id: billId } });
}

export async function ensureLogisticsExpenseBill(
  order: LogisticsExpenseOrderForAccess,
  supplier: LogisticsSupplierForExpense | null,
  actor: LogisticsActor,
  input: UnknownRecord = {},
  db: LogisticsExpenseBillWriteDb = prisma,
) {
  const billOfLadingNo = logisticsExpenseBillOfLadingNo(order);
  const supplierId = nonEmpty(supplier?.id || input.supplierId || input.supplier_id);
  const billKey = logisticsExpenseBillKey(order.id, billOfLadingNo, supplierId);
  const legacyBillKey = logisticsExpenseLegacyBillKey(order.id, billOfLadingNo);
  if (!billKey) throw codedError("物流费用账单编号无效。", 400, "LOGISTICS_EXPENSE_BILL_KEY_INVALID");
  const requestedStatus = nonEmpty(input.auditStatus || input.status || "草稿");
  const auditStatus = LOGISTICS_EXPENSE_AUDIT_STATUSES.includes(requestedStatus) ? requestedStatus : "草稿";
  const now = new Date();
  const existing = await db.logisticsBill.findUnique({ where: { billKey } });
  if (existing) {
    return updateAppendableLogisticsExpenseBill(
      db,
      existing.id,
      actor,
      auditStatus,
      input.submittedAt,
      now,
      supplierId ? { supplierId } : {},
    );
  }
  const legacyBill = legacyBillKey
      ? await db.logisticsBill.findFirst({
        where: { billKey: legacyBillKey, deletedAt: null },
        select: { id: true, supplierId: true },
      })
      : null;
    const legacySuppliers = legacyBill
      ? await db.logisticsExpense.findMany({
        where: {
          billId: legacyBill.id,
          deletedAt: null,
        },
        distinct: ["supplierId"],
        select: { supplierId: true },
        take: 2,
      })
      : [];
    const legacySupplierIds = legacySuppliers.map((row) => nonEmpty(row.supplierId)).filter(Boolean);
    const legacyHasOnlyThisSupplier = legacyBill
      && supplierId
      && (!legacyBill.supplierId || legacyBill.supplierId === supplierId)
      && (!legacySupplierIds.length || (legacySupplierIds.length === 1 && legacySupplierIds[0] === supplierId));
    if (legacyHasOnlyThisSupplier) {
      return updateAppendableLogisticsExpenseBill(
        db,
        legacyBill.id,
        actor,
        auditStatus,
        input.submittedAt,
        now,
        {
          billKey,
          supplierId,
          billOfLadingNo,
        },
      );
    }
  try {
    return await db.logisticsBill.create({
      data: {
      billKey,
      orderId: order.id,
      supplierId: supplierId || null,
      billOfLadingNo,
      auditStatus,
      invoiceStatus: "待开票",
      paymentStatus: "待开票",
      submittedAt: auditStatus === "待审核" ? (dateFromInput(input.submittedAt) || now) : null,
      submittedById: auditStatus === "待审核" ? (logisticsExpenseActorId(actor) || null) : null,
      createdById: logisticsExpenseActorId(actor) || null,
      updatedById: logisticsExpenseActorId(actor) || null,
    },
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === "P2002") {
      throw codedError("同一订单/供应商的物流费用账单正在创建，请刷新后重试。", 409, "LOGISTICS_BILL_CREATE_CONFLICT");
    }
    throw error;
  }
}

export async function loadLogisticsExpenseForAction(id: string, actor: LogisticsActor) {
  const expense = await prisma.logisticsExpense.findFirst({
    where: {
      id,
      deletedAt: null,
      ...logisticsExpenseAccessWhere(actor),
    },
    include: includeLogisticsExpenseRelations(),
  });
  if (!expense) throw permissionError("物流费用不存在或无权访问", 404);
  assertBusinessNotArchived(expense.order, "该订单已提交退税并归档，物流费用只允许查看和下载。");
  return expense;
}
