// @ts-nocheck
import { prisma } from "../prisma";
import {
  PAYMENT_STATUSES,
  PAYMENT_INPUT_SCHEMA,
  PAYMENT_TYPES,
  amountCny,
  applyCommonFilters,
  assertInputSchema,
  assertJsonObject,
  assertWrite,
  dateFromInput,
  effectivePermissions,
  includeOrderRelations,
  nonEmpty,
  optional,
  pageParams,
  pageResult,
  permissionError,
  requirePositive,
  requireText,
  resolveExchangeRateSnapshot,
  runNonCriticalTask,
  serializePayment,
  todayInputInChina,
  writeAudit,
} from "./shared";
import { assertRead } from "./shared-auth";
import {
  assertOrderOpen,
  canAccessOrder,
  orderAccessWhere,
} from "./order-access";
import { syncOrderStatus } from "./orders-module";

export async function listPayments(query, actor = null, options = {}) {
  assertRead(actor, "payments");
  const accessWhere = orderAccessWhere(actor);
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const where = paymentListWhere(query, accessWhere);
    const currentMonth = todayInputInChina().slice(0, 7);
    const currentMonthStart = new Date(`${currentMonth}-01T00:00:00.000Z`);
    const currentMonthEnd = new Date(currentMonthStart);
    currentMonthEnd.setUTCMonth(currentMonthEnd.getUTCMonth() + 1);
    const [total, rows, arrived, pending, currentMonthCount] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true },
        orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.payment.aggregate({
        where: withPaymentWhere(where, { status: "已到账" }),
        _sum: { amountCny: true },
      }),
      prisma.payment.aggregate({
        where: withPaymentWhere(where, { status: "待确认" }),
        _sum: { amountCny: true },
      }),
      prisma.payment.count({
        where: withPaymentWhere(where, {
          OR: [
            { paymentDate: { gte: currentMonthStart, lt: currentMonthEnd } },
            { createdAt: { gte: currentMonthStart, lt: currentMonthEnd } },
          ],
        }),
      }),
    ]);
    return {
      ...pageResult(rows.map(serializePayment), total, page, pageSize),
      summary: {
        arrivedAmountCny: Number(arrived._sum.amountCny || 0),
        pendingAmountCny: Number(pending._sum.amountCny || 0),
        currentMonthCount,
      },
    };
  }
  const rows = await prisma.payment.findMany({
    where: { deletedAt: null, order: { is: accessWhere } },
    include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true },
    orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
  });
  return applyCommonFilters(rows.map(serializePayment), query);
}

function withPaymentWhere(where, condition) {
  return { AND: [where, condition] };
}

function paymentListWhere(query, accessWhere) {
  const keyword = nonEmpty(query?.get("keyword"));
  const orderText = nonEmpty(query?.get("orderNo") || query?.get("searchOrderNo") || query?.get("order"));
  const party = nonEmpty(query?.get("party"));
  const currency = nonEmpty(query?.get("currency"));
  const paymentStatus = nonEmpty(query?.get("paymentStatus"));
  const month = nonEmpty(query?.get("month"));
  const filters = [{ deletedAt: null }, { order: { is: accessWhere } }];
  if (currency) filters.push({ currency });
  if (paymentStatus) filters.push({ status: paymentStatus });
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    filters.push({ OR: [{ paymentDate: { gte: start, lt: end } }, { createdAt: { gte: start, lt: end } }] });
  }
  if (keyword) {
    filters.push({
      OR: [
        { bankReference: { contains: keyword, mode: "insensitive" } },
        { remark: { contains: keyword, mode: "insensitive" } },
        {
          order: {
            is: {
              OR: [
                { orderNo: { contains: keyword, mode: "insensitive" } },
                { blNo: { contains: keyword, mode: "insensitive" } },
                { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
                { country: { contains: keyword, mode: "insensitive" } },
                { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
                { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
                { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
              ],
            },
          },
        },
      ],
    });
  }
  if (orderText) {
    filters.push({
      order: {
        is: {
          OR: [
            { orderNo: { contains: orderText, mode: "insensitive" } },
            { blNo: { contains: orderText, mode: "insensitive" } },
          ],
        },
      },
    });
  }
  if (party) {
    filters.push({
      order: {
        is: {
          OR: [
            { customerNameSnapshot: { contains: party, mode: "insensitive" } },
            { customer: { is: { name: { contains: party, mode: "insensitive" } } } },
            { customer: { is: { shortName: { contains: party, mode: "insensitive" } } } },
            { salesperson: { is: { name: { contains: party, mode: "insensitive" } } } },
          ],
        },
      },
    });
  }
  return { AND: filters };
}

export async function savePayment(request, actor, input, id = null) {
  assertWrite(actor, "payments");
  input = assertInputSchema(assertJsonObject(input), PAYMENT_INPUT_SCHEMA);
  const before = id ? await prisma.payment.findFirst({ where: { id, deletedAt: null } }) : null;
  if (id && !before) throw Object.assign(new Error("收款记录不存在或已删除"), { status: 404 });
  const order = await assertOrderOpen(requireText(input.orderId, "关联订单"), actor);
  if (!id || before.orderId !== order.id) {
    const { assertOrderCanReceivePayment } = await import("./order-access");
    await assertOrderCanReceivePayment(order);
  }
  const amount = requirePositive(input.amount, "收款金额");
  const paymentDate = dateFromInput(input.paymentDate) || dateFromInput(todayInputInChina());
  const currency = requireText(input.currency || order.currency, "币种");
  const exchange = await resolveExchangeRateSnapshot(input, actor, {
    currency,
    defaultDate: paymentDate,
    allowHistoricalSource: before?.exchangeRateSource === "历史录入",
  });
  const exchangeRate = exchange.exchangeRate;
  const requestedStatus = PAYMENT_STATUSES.includes(input.status) ? input.status : "待确认";
  const data = {
    orderId: order.id,
    paymentDate,
    currency: exchange.currency,
    exchangeRate,
    exchangeRateDate: exchange.exchangeRateDate,
    exchangeRateSource: exchange.exchangeRateSource,
    exchangeRateType: exchange.exchangeRateType,
    amount,
    amountCny: amountCny(amount, exchangeRate),
    paymentType: PAYMENT_TYPES.includes(input.paymentType) ? input.paymentType : "尾款",
    status: requestedStatus,
    bankReference: optional(input.bankReference),
    remark: optional(input.remark),
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const payment = id
    ? await prisma.payment.update({ where: { id }, data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } })
    : await prisma.payment.create({ data, include: { order: { include: { customer: true, salesperson: true } }, createdBy: true, updatedBy: true } });
  await syncOrderStatus(order.id);
  if (before?.orderId && before.orderId !== order.id) await syncOrderStatus(before.orderId);
  const auditAction = id && before?.status !== requestedStatus ? `修改收款状态：${before.status}→${requestedStatus}` : (id ? "更新收款" : "新增收款");
  await runNonCriticalTask("收款操作日志写入", () => writeAudit(request, actor, auditAction, "payments", payment.id, before, payment));
  return serializePayment(payment);
}

export async function deletePayment(request, actor, id) {
  assertWrite(actor, "payments");
  const before = await prisma.payment.findUnique({ where: { id }, include: { order: { include: { customer: true } } } });
  if (!before || before.deletedAt) throw permissionError("收款记录不存在或已删除", 404);
  if (!canAccessOrder(actor, before.order)) throw permissionError("无权限删除该收款记录");
  const payment = await prisma.payment.update({
    where: { id },
    data: { deletedAt: new Date(), updatedById: actor.id },
  });
  await syncOrderStatus(payment.orderId);
  await runNonCriticalTask("收款删除操作日志写入", () => writeAudit(request, actor, "删除收款", "payments", id, before, payment));
}
