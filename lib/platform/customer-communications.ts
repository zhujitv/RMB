import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES, SHIPPING_DOCUMENT_TYPE_CONFIG, assertRead, assertWrite, canRead,
  codedError, customerFullName, customerShortName, logServerError, nonEmpty,
  normalizeClearanceEmailLanguage, pageParams, pageResult, parseEmailList, permissionError,
  runNonCriticalTask, serializeShippingDocumentNotification, writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import {
  canSendCustomerCommunication, getShippingDocumentDraftForOrder, sendManualShippingDocumentsNotification,
} from "./shipping-documents";
import {
  COMMUNICATION_FILE_TYPES, CUSTOMER_EMAIL_TYPES, clearanceMissingLabels, latestManualMarkNotification,
  orderSelect, serializeAvailableFile, serializeCommunicationRow, shippingRecipientEmails,
  type CommunicationOrder,
} from "./customer-communication-model";

type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
type QueryLike = URLSearchParams;
type AuditRequestLike = Parameters<typeof sendManualShippingDocumentsNotification>[0];
type ManualMarkInput = Record<string, unknown>;

const CUSTOMER_COMMUNICATION_ENABLED_WHERE: Prisma.ReceivableOrderWhereInput = {
  customer: { is: { enableAutoShippingDocsNotification: true, deletedAt: null } },
};
const MANUAL_SEND_METHODS = new Set(["系统邮件", "手动邮件", "微信", "QQ", "WhatsApp", "客户平台", "其它"]);

function customerCommunicationEnabledWhere(where: Prisma.ReceivableOrderWhereInput): Prisma.ReceivableOrderWhereInput {
  return { AND: [where, CUSTOMER_COMMUNICATION_ENABLED_WHERE] };
}

function customerCommunicationWhere(actor: ActorLike): Prisma.ReceivableOrderWhereInput {
  assertRead(actor, "customerCommunication");
  const role = String(actor?.role || "");
  if (role === "管理员" || role === "物流资料录入员") {
    return customerCommunicationEnabledWhere({ deletedAt: null });
  }
  if (role === "业务员") {
    return customerCommunicationEnabledWhere({ deletedAt: null, ...orderAccessWhere(actor) });
  }
  if (role === "物流供应商") {
    const supplierId = nonEmpty(actor?.supplierId);
    return supplierId
      ? customerCommunicationEnabledWhere({ deletedAt: null, logisticsSuppliers: { some: { supplierId } } })
      : { id: "__no_customer_communication_access__" };
  }
  if (canRead(actor, "orders")) {
    return customerCommunicationEnabledWhere({ deletedAt: null, ...orderAccessWhere(actor) });
  }
  return { id: "__no_customer_communication_access__" };
}

function communicationKeywordWhere(keyword: string): Prisma.ReceivableOrderWhereInput {
  if (!keyword) return {};
  return { OR: [
    { orderNo: { contains: keyword, mode: "insensitive" } },
    { blNo: { contains: keyword, mode: "insensitive" } },
    { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
    { businessEntityNameSnapshot: { contains: keyword, mode: "insensitive" } },
    { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
    { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
    { businessEntity: { is: { name: { contains: keyword, mode: "insensitive" } } } },
    { businessEntity: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
  ] };
}

export async function listCustomerCommunications(query: QueryLike, actor: ActorLike) {
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  const { page, pageSize } = pageParams(query, 20, 100);
  const where: Prisma.ReceivableOrderWhereInput = {
    AND: [customerCommunicationWhere(actor), communicationKeywordWhere(keyword)],
  };
  const [total, rows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where, select: orderSelect,
      orderBy: [{ customsDeclarationDate: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize,
    }),
  ]);
  return { ...pageResult(rows.map(serializeCommunicationRow), total, page, pageSize), query: keyword };
}

export async function getCustomerCommunicationDetail(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, ...customerCommunicationWhere(actor) }, select: orderSelect,
  });
  if (!order) throw permissionError("订单不存在或无权查看客户沟通资料", 404);
  let draft: Awaited<ReturnType<typeof getShippingDocumentDraftForOrder>> | null = null;
  try {
    draft = await getShippingDocumentDraftForOrder(actor, orderId);
  } catch (error) {
    logServerError("客户沟通清关资料草稿生成失败", error, { orderId });
  }
  const customer = order.customer || null;
  return {
    order: serializeCommunicationRow(order),
    canSend: canSendCustomerCommunication(actor),
    emailTypes: CUSTOMER_EMAIL_TYPES,
    customer: {
      id: customer?.id || "",
      fullName: customerFullName(customer || {}, order.customerNameSnapshot),
      shortName: customerShortName(customer || {}) || order.customerNameSnapshot,
      defaultToEmails: shippingRecipientEmails(customer),
      defaultCcEmails: parseEmailList(customer?.shippingDocsCcEmails || []),
      languagePreference: normalizeClearanceEmailLanguage(customer?.clearanceEmailLanguage || "EN", customer?.country || ""),
    },
    availableFiles: COMMUNICATION_FILE_TYPES.map((item) => serializeAvailableFile(order, item)),
    draft,
    missingLabels: clearanceMissingLabels(order),
    records: (order.shippingDocumentNotifications || []).map((row) => ({
      ...serializeShippingDocumentNotification(row, order),
      emailType: CUSTOMER_EMAIL_TYPES.CUSTOMS_CLEARANCE_DOCS,
      emailTypeLabel: "清关资料",
    })),
  };
}

export async function sendCustomerCommunicationClearanceDocuments(
  request: AuditRequestLike, actor: ActorLike, orderId: string, input: Record<string, unknown>,
) {
  await sendManualShippingDocumentsNotification(request, actor, orderId, {
    ...input, emailType: CUSTOMER_EMAIL_TYPES.CUSTOMS_CLEARANCE_DOCS,
  });
  return getCustomerCommunicationDetail(orderId, actor);
}

function assertManualMarkPermission(actor: ActorLike) {
  assertWrite(actor, "customerCommunication");
  const role = String(actor?.role || "");
  if (!["管理员", "业务员"].includes(role)) {
    throw permissionError("当前账号无权手动标记客户沟通发送状态", 403);
  }
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  return actorId;
}

function loadManualInput(input: ManualMarkInput) {
  const method = nonEmpty(input.deliveryMethod || input.sendMethod || input.method) || "手动邮件";
  if (!MANUAL_SEND_METHODS.has(method)) {
    throw codedError("请选择有效的发送方式。", 400, "CUSTOMER_COMMUNICATION_SEND_METHOD_INVALID");
  }
  const sentAtText = nonEmpty(input.sentAt);
  const sentAt = sentAtText ? new Date(sentAtText) : new Date();
  if (Number.isNaN(sentAt.getTime())) {
    throw codedError("请选择有效的发送时间。", 400, "CUSTOMER_COMMUNICATION_SENT_AT_INVALID");
  }
  return { method, sentAt, remark: nonEmpty(input.remark || input.manualRemark)?.slice(0, 500) || null };
}

async function loadCustomerCommunicationOrder(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, ...customerCommunicationWhere(actor) }, select: orderSelect,
  });
  if (!order) throw permissionError("订单不存在或无权查看客户沟通资料", 404);
  if (!order.customerId || !order.customer) {
    throw codedError("订单未关联客户，不能标记清关资料发送状态。", 400, "CUSTOMER_REQUIRED");
  }
  return order;
}

function manualMarkAttachmentIds(order: CommunicationOrder) {
  const required = new Set(Object.values(SHIPPING_DOCUMENT_TYPE_CONFIG).map((item) => item.documentType));
  return order.documents
    .filter((document) => required.has(document.documentType || ""))
    .filter((document) => document.uploadStatus === "SUCCESS" && !document.deletedAt)
    .flatMap((document) => document.id ? [document.id] : []);
}

export async function markCustomerCommunicationSent(
  request: AuditRequestLike, actor: ActorLike, orderId: string, input: ManualMarkInput = {},
) {
  const actorId = assertManualMarkPermission(actor);
  const order = await loadCustomerCommunicationOrder(orderId, actor);
  const { method, sentAt, remark } = loadManualInput(input);
  const customer = order.customer || null;
  const record = await prisma.shippingDocumentNotification.create({
    data: {
      orderId: order.id, customerId: order.customerId || "", invoiceId: null, sentById: actorId,
      recipientEmails: shippingRecipientEmails(customer),
      ccEmails: parseEmailList(customer?.shippingDocsCcEmails || []),
      documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES,
      attachmentFileIds: manualMarkAttachmentIds(order), sendStatus: "SUCCESS", sendMode: "manual_mark",
      deliveryMethod: method, manualRemark: remark, isSystemSent: false,
      emailSubject: "手动标记清关资料已发送", emailBody: remark || null, errorMessage: null, sentAt,
    },
    include: { sentBy: true },
  });
  await runNonCriticalTask("客户沟通手动标记已发送日志写入", () => writeAudit(
    request, actor, "手动标记清关资料已发送", "shipping_document_notifications", record.id, null,
    { orderNo: order.orderNo, deliveryMethod: method, sentAt, remark, isSystemSent: false },
  ));
  return getCustomerCommunicationDetail(orderId, actor);
}

export async function unmarkCustomerCommunicationSent(request: AuditRequestLike, actor: ActorLike, orderId: string) {
  assertManualMarkPermission(actor);
  const order = await loadCustomerCommunicationOrder(orderId, actor);
  const latestManual = latestManualMarkNotification(order);
  if (!latestManual?.id) {
    throw codedError("当前订单没有可取消的手动发送标记。", 400, "CUSTOMER_COMMUNICATION_MANUAL_MARK_NOT_FOUND");
  }
  const updated = await prisma.shippingDocumentNotification.update({
    where: { id: latestManual.id },
    data: { sendStatus: "CANCELLED", errorMessage: "手动发送标记已取消" },
    include: { sentBy: true },
  });
  await runNonCriticalTask("客户沟通取消手动标记日志写入", () => writeAudit(
    request, actor, "取消手动标记清关资料已发送", "shipping_document_notifications", updated.id, latestManual,
    { orderNo: order.orderNo, deliveryMethod: latestManual.deliveryMethod || "",
      sentAt: latestManual.sentAt, remark: latestManual.manualRemark || "" },
  ));
  return getCustomerCommunicationDetail(orderId, actor);
}
