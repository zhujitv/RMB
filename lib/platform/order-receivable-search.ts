import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertRead,
  canWrite,
  customerBusinessName,
  customerFullName,
  customerShortName,
  dateToInput,
  effectivePermissions,
  includeOrderRelations,
  nonEmpty,
  serializeOrder,
  summarizeOrder,
} from "./shared";
import {
  orderAccessWhere,
  scopeOrderForActor,
} from "./order-access";

type ActorLike = ({
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} & Record<string, unknown>) | null | undefined;
type QueryLike = URLSearchParams;
type OrderWithRelations = Prisma.ReceivableOrderGetPayload<{ include: ReturnType<typeof includeOrderRelations> }>;

function serializeReceivableSearchOrder(order: OrderWithRelations) {
  const fullCustomerName = customerFullName(order.customer, order.customerNameSnapshot);
  const shortCustomerName = customerShortName(order.customer);
  const summary = summarizeOrder(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    blNo: order.blNo || "",
    billOfLadingNo: order.blNo || "",
    customerId: order.customerId || "",
    customerName: shortCustomerName || fullCustomerName,
    customerFullName: fullCustomerName,
    customerShortName: shortCustomerName,
    customerNameSnapshot: fullCustomerName,
    salespersonId: order.salespersonUserId || "",
    salespersonUserId: order.salespersonUserId || "",
    salespersonName: order.salesperson?.name || "",
    country: order.customer?.country || order.country || "",
    currency: order.currency,
    exchangeRate: Number(order.exchangeRate),
    exchangeRateDate: dateToInput(order.exchangeRateDate),
    exchangeRateSource: order.exchangeRateSource || "",
    exchangeRateType: order.exchangeRateType || "",
    receivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    receivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    finalReceivableAmount: Number(order.finalReceivableAmount ?? order.receivableAmount),
    finalReceivableAmountCny: Number(order.finalReceivableAmountCny ?? order.receivableAmountCny),
    receivedAmount: Number(summary.confirmedPaymentsAmount || 0),
    receivedAmountCny: Number(summary.confirmedPaymentsCny || 0),
    outstandingAmount: Number(summary.outstandingAmount || 0),
    outstandingCny: Number(summary.outstandingCny || 0),
    status: order.status,
    dueDate: dateToInput(order.dueDate),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    summary: {
      receivableAmount: Number(summary.receivableAmount || 0),
      receivableCny: Number(summary.receivableCny || 0),
      confirmedPaymentsAmount: Number(summary.confirmedPaymentsAmount || 0),
      confirmedPaymentsCny: Number(summary.confirmedPaymentsCny || 0),
      outstandingAmount: Number(summary.outstandingAmount || 0),
      outstandingCny: Number(summary.outstandingCny || 0),
    },
  };
}

function receivableOrderCanAcceptPayment(order: OrderWithRelations) {
  return !["已关闭", "已取消"].includes(order.status);
}

export async function searchReceivableOrders(query: QueryLike, actor: ActorLike) {
  assertRead(actor, "orders");
  const q = nonEmpty(query.get("q"));
  const purpose = nonEmpty(query.get("purpose") || query.get("mode"));
  const isPaymentSearch = purpose === "payment" || purpose === "payments";
  const scope = effectivePermissions(actor).dataScope;
  const isCostEntrySearch = canWrite(actor, "costs") && scope === "OWN_COST";
  if (isCostEntrySearch && !q) return [];
  const accessWhere: Prisma.ReceivableOrderWhereInput = isCostEntrySearch ? {} : orderAccessWhere(actor);
  const filters: Prisma.ReceivableOrderWhereInput[] = [accessWhere];
  if (q) {
    filters.push({
      OR: [
        { orderNo: { contains: q, mode: "insensitive" } },
        { blNo: { contains: q, mode: "insensitive" } },
        { customerNameSnapshot: { contains: q, mode: "insensitive" } },
        { customer: { is: { name: { contains: q, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: q, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const where: Prisma.ReceivableOrderWhereInput = {
    deletedAt: null,
    ...(isPaymentSearch ? { status: { notIn: ["已关闭", "已取消"] } } : {}),
    ...(filters.length ? { AND: filters } : {}),
  };
  const orders = await prisma.receivableOrder.findMany({
    where,
    include: includeOrderRelations(),
    orderBy: [{ createdAt: "desc" }],
    take: isPaymentSearch ? 50 : 20,
  });
  const resultOrders = isPaymentSearch ? orders.filter(receivableOrderCanAcceptPayment).slice(0, 20) : orders;
  if (isCostEntrySearch) {
    return resultOrders.map((order) => ({
      id: order.id,
      orderNo: order.orderNo,
      blNo: order.blNo || "",
      billOfLadingNo: order.blNo || "",
      customerName: customerBusinessName(order.customer, order.customerNameSnapshot),
      customerFullName: customerFullName(order.customer, order.customerNameSnapshot),
      customerShortName: customerShortName(order.customer),
      status: order.status,
      dueDate: dateToInput(order.dueDate),
    }));
  }
  return resultOrders.map((order) => (
    isPaymentSearch
      ? serializeReceivableSearchOrder(scopeOrderForActor(order, actor))
      : serializeOrder(scopeOrderForActor(order, actor))
  ));
}
