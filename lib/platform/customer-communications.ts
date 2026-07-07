import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  assertRead,
  assertWrite,
  canRead,
  codedError,
  customerFullName,
  customerShortName,
  dateToInput,
  logServerError,
  nonEmpty,
  normalizeClearanceEmailLanguage,
  pageParams,
  pageResult,
  parseEmailList,
  permissionError,
  runNonCriticalTask,
  serializeShippingDocumentNotification,
  writeAudit,
} from "./shared";
import { orderAccessWhere } from "./order-access";
import {
  canSendCustomerCommunication,
  getShippingDocumentDraftForOrder,
  sendManualShippingDocumentsNotification,
} from "./shipping-documents";

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
  customer: {
    is: {
      enableAutoShippingDocsNotification: true,
      deletedAt: null,
    },
  },
};

const CUSTOMER_EMAIL_TYPES = {
  CUSTOMS_CLEARANCE_DOCS: "CUSTOMS_CLEARANCE_DOCS",
  SHIPPING_ADVICE: "SHIPPING_ADVICE",
  BILL_OF_LADING: "BILL_OF_LADING",
  TELEX_RELEASE_NOTICE: "TELEX_RELEASE_NOTICE",
  ETA_NOTICE: "ETA_NOTICE",
  PAYMENT_REMINDER: "PAYMENT_REMINDER",
  AFTER_SALES: "AFTER_SALES",
} as const;

const MANUAL_SEND_METHODS = new Set(["系统邮件", "手动邮件", "微信", "QQ", "WhatsApp", "客户平台", "其它"]);
const ACTIVE_SENT_STATUSES = new Set(["sent", "SUCCESS"]);

const COMMUNICATION_FILE_TYPES = [
  { key: "commercialInvoice", label: "Commercial Invoice", documentType: "COMMERCIAL_INVOICE", requiredForClearance: true },
  { key: "packingList", label: "Packing List", documentType: "PACKING_LIST", requiredForClearance: true },
  { key: "customsDeclaration", label: "Customs Declaration / 报关单", documentType: "CUSTOMS_ENTRY_FORM", requiredForClearance: true },
  { key: "billOfLading", label: "Bill of Lading / 提单", documentType: "BILL_OF_LADING", requiredForClearance: false },
  { key: "shippingAdvice", label: "Shipping Advice", documentType: "", requiredForClearance: false },
  { key: "telexReleaseNotice", label: "Telex Release Notice", documentType: "", requiredForClearance: false },
  { key: "etaNotice", label: "ETA Notice", documentType: "", requiredForClearance: false },
];

const orderSelect = Prisma.validator<Prisma.ReceivableOrderSelect>()({
  id: true,
  orderNo: true,
  blNo: true,
  customerId: true,
  customerNameSnapshot: true,
  businessEntityNameSnapshot: true,
  customsDeclarationDate: true,
  deletedAt: true,
  customer: {
    select: {
      id: true,
      name: true,
      shortName: true,
      country: true,
      contactEmail: true,
      enableAutoShippingDocsNotification: true,
      shippingDocsEmails: true,
      shippingDocsCcEmails: true,
      autoSendDocumentTypes: true,
      clearanceEmailLanguage: true,
      salespersonUserId: true,
    },
  },
  businessEntity: { select: { id: true, name: true, shortName: true, isDefault: true } },
  documents: {
    where: { deletedAt: null },
    select: {
      id: true,
      documentType: true,
      uploadStatus: true,
      deletedAt: true,
      mimeType: true,
      originalFilename: true,
      originalName: true,
      fileName: true,
      uploadedAt: true,
      createdAt: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: [{ documentType: "asc" }, { uploadedAt: "desc" }, { createdAt: "desc" }],
  },
  domesticLogisticsInfos: {
    where: { deletedAt: null },
    select: { id: true, financeStatus: true, submittedAt: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }],
    take: 1,
  },
  logisticsSuppliers: { select: { supplierId: true } },
  shippingDocumentNotifications: {
    include: { sentBy: true },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  },
});

type CommunicationOrder = Prisma.ReceivableOrderGetPayload<{ select: typeof orderSelect }>;

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
  return {
    OR: [
      { orderNo: { contains: keyword, mode: "insensitive" } },
      { blNo: { contains: keyword, mode: "insensitive" } },
      { customerNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { businessEntityNameSnapshot: { contains: keyword, mode: "insensitive" } },
      { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
      { businessEntity: { is: { name: { contains: keyword, mode: "insensitive" } } } },
      { businessEntity: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
    ],
  };
}

function latestDocumentByType(order: CommunicationOrder, documentType: string) {
  if (!documentType) return null;
  return (order.documents || []).find((document) => (
    document.documentType === documentType
    && document.uploadStatus === "SUCCESS"
    && !document.deletedAt
    && String(document.mimeType || "").toLowerCase() === "application/pdf"
  )) || null;
}

function clearanceMissingLabels(order: CommunicationOrder) {
  const configMap = SHIPPING_DOCUMENT_TYPE_CONFIG as Record<string, { documentType: string; label: string }>;
  return DEFAULT_SHIPPING_DOCUMENT_TYPES
    .map((typeKey) => configMap[typeKey])
    .filter(Boolean)
    .filter((config) => !latestDocumentByType(order, config.documentType))
    .map((config) => config.label);
}

function latestNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => row.sendStatus !== "CANCELLED") || null;
}

function latestSentNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => (
    ACTIVE_SENT_STATUSES.has(String(row.sendStatus || "")) && row.sentAt
  )) || null;
}

function latestManualMarkNotification(order: CommunicationOrder) {
  return (order.shippingDocumentNotifications || []).find((row) => (
    ACTIVE_SENT_STATUSES.has(String(row.sendStatus || ""))
    && row.sentAt
    && (row.sendMode === "manual_mark" || row.isSystemSent === false)
  )) || null;
}

function clearanceStatus(order: CommunicationOrder) {
  const latest = latestNotification(order);
  const status = String(latest?.sendStatus || "");
  if (ACTIVE_SENT_STATUSES.has(status) && (latest?.sendMode === "manual_mark" || latest?.isSystemSent === false)) {
    return { value: "MANUAL_SENT", label: "手动已发送" };
  }
  if (ACTIVE_SENT_STATUSES.has(status)) return { value: "SENT", label: "已发送" };
  if (["failed", "FAILED"].includes(status)) return { value: "FAILED", label: "发送失败" };
  const missing = clearanceMissingLabels(order);
  if (missing.length) return { value: "MISSING", label: "附件缺失" };
  return { value: "READY", label: "待发送" };
}

function logisticsStatus(order: CommunicationOrder) {
  const info = (order.domesticLogisticsInfos || [])[0];
  if (!info) return "未录入";
  if (info.financeStatus === "APPROVED") return "已确认";
  if (info.financeStatus === "REJECTED") return "已驳回";
  return "已录入";
}

function businessEntityName(order: CommunicationOrder) {
  return order.businessEntity?.shortName || order.businessEntity?.name || order.businessEntityNameSnapshot || "";
}

function businessEntityIsDefault(order: CommunicationOrder) {
  return typeof order.businessEntity?.isDefault === "boolean" ? order.businessEntity.isDefault : true;
}

function shippingRecipientEmails(customer: CommunicationOrder["customer"] | null | undefined) {
  const configured = parseEmailList(customer?.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer?.contactEmail || "");
}

function serializeAvailableFile(order: CommunicationOrder, item: (typeof COMMUNICATION_FILE_TYPES)[number]) {
  const document = latestDocumentByType(order, item.documentType);
  return {
    key: item.key,
    label: item.label,
    documentType: item.documentType,
    requiredForClearance: item.requiredForClearance,
    exists: Boolean(document),
    documentId: document?.id || "",
    fileName: document?.originalFilename || document?.originalName || document?.fileName || "",
    uploadedBy: document?.uploadedBy?.name || "",
    uploadedAt: document?.uploadedAt || document?.createdAt || null,
    previewUrl: document?.id ? `/api/order-documents/${encodeURIComponent(document.id)}/preview` : "",
    downloadUrl: document?.id ? `/api/order-documents/${encodeURIComponent(document.id)}/download` : "",
  };
}

function serializeCommunicationRow(order: CommunicationOrder) {
  const latest = latestNotification(order);
  const latestSent = latestSentNotification(order);
  const latestManualMark = latestManualMarkNotification(order);
  const status = clearanceStatus(order);
  return {
    id: order.id,
    orderNo: order.orderNo,
    customerShortName: customerShortName(order.customer || {}) || order.customerNameSnapshot,
    billOfLadingNo: order.blNo || "",
    businessEntityName: businessEntityName(order),
    businessEntityIsDefault: businessEntityIsDefault(order),
    declarationDate: dateToInput(order.customsDeclarationDate),
    logisticsStatus: logisticsStatus(order),
    clearanceStatus: status.value,
    clearanceStatusLabel: status.label,
    latestSentAt: latestSent?.sentAt || latest?.sentAt || null,
    manualMarked: Boolean(latestManualMark),
    latestManualMarkId: latestManualMark?.id || "",
  };
}

export async function listCustomerCommunications(query: QueryLike, actor: ActorLike) {
  const keyword = nonEmpty(query.get("keyword") || query.get("q"));
  const { page, pageSize } = pageParams(query, 20, 100);
  const where: Prisma.ReceivableOrderWhereInput = {
    AND: [
      customerCommunicationWhere(actor),
      communicationKeywordWhere(keyword),
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.receivableOrder.count({ where }),
    prisma.receivableOrder.findMany({
      where,
      select: orderSelect,
      orderBy: [{ customsDeclarationDate: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return {
    ...pageResult(rows.map(serializeCommunicationRow), total, page, pageSize),
    query: keyword,
  };
}

export async function getCustomerCommunicationDetail(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, ...customerCommunicationWhere(actor) },
    select: orderSelect,
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
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: Record<string, unknown>,
) {
  await sendManualShippingDocumentsNotification(request, actor, orderId, {
    ...input,
    emailType: CUSTOMER_EMAIL_TYPES.CUSTOMS_CLEARANCE_DOCS,
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

function manualSendMethod(input: ManualMarkInput) {
  const method = nonEmpty(input.deliveryMethod || input.sendMethod || input.method) || "手动邮件";
  if (!MANUAL_SEND_METHODS.has(method)) {
    throw codedError("请选择有效的发送方式。", 400, "CUSTOMER_COMMUNICATION_SEND_METHOD_INVALID");
  }
  return method;
}

function manualSentAt(input: ManualMarkInput) {
  const sentAtText = nonEmpty(input.sentAt);
  const sentAt = sentAtText ? new Date(sentAtText) : new Date();
  if (!sentAt || Number.isNaN(sentAt.getTime())) {
    throw codedError("请选择有效的发送时间。", 400, "CUSTOMER_COMMUNICATION_SENT_AT_INVALID");
  }
  return sentAt;
}

function manualRemark(input: ManualMarkInput) {
  return nonEmpty(input.remark || input.manualRemark)?.slice(0, 500) || null;
}

function manualMarkAttachmentIds(order: CommunicationOrder) {
  const requiredDocumentTypes = new Set(Object.values(SHIPPING_DOCUMENT_TYPE_CONFIG).map((item) => item.documentType));
  return (order.documents || [])
    .filter((document) => requiredDocumentTypes.has(document.documentType || ""))
    .filter((document) => document.uploadStatus === "SUCCESS" && !document.deletedAt)
    .flatMap((document) => document.id ? [document.id] : []);
}

async function loadCustomerCommunicationOrder(orderId: string, actor: ActorLike) {
  const order = await prisma.receivableOrder.findFirst({
    where: { id: orderId, ...customerCommunicationWhere(actor) },
    select: orderSelect,
  });
  if (!order) throw permissionError("订单不存在或无权查看客户沟通资料", 404);
  if (!order.customerId || !order.customer) throw codedError("订单未关联客户，不能标记清关资料发送状态。", 400, "CUSTOMER_REQUIRED");
  return order;
}

export async function markCustomerCommunicationSent(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: ManualMarkInput = {},
) {
  const actorId = assertManualMarkPermission(actor);
  const order = await loadCustomerCommunicationOrder(orderId, actor);
  const method = manualSendMethod(input);
  const sentAt = manualSentAt(input);
  const remark = manualRemark(input);
  const customer = order.customer || null;
  const record = await prisma.shippingDocumentNotification.create({
    data: {
      orderId: order.id,
      customerId: order.customerId || "",
      invoiceId: null,
      sentById: actorId,
      recipientEmails: shippingRecipientEmails(customer),
      ccEmails: parseEmailList(customer?.shippingDocsCcEmails || []),
      documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES,
      attachmentFileIds: manualMarkAttachmentIds(order),
      sendStatus: "SUCCESS",
      sendMode: "manual_mark",
      deliveryMethod: method,
      manualRemark: remark,
      isSystemSent: false,
      emailSubject: "手动标记清关资料已发送",
      emailBody: remark || null,
      errorMessage: null,
      sentAt,
    },
    include: { sentBy: true },
  });
  await runNonCriticalTask("客户沟通手动标记已发送日志写入", () => writeAudit(
    request,
    actor,
    "手动标记清关资料已发送",
    "shipping_document_notifications",
    record.id,
    null,
    {
      orderNo: order.orderNo,
      deliveryMethod: method,
      sentAt,
      remark,
      isSystemSent: false,
    },
  ));
  return getCustomerCommunicationDetail(orderId, actor);
}

export async function unmarkCustomerCommunicationSent(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
) {
  assertManualMarkPermission(actor);
  const order = await loadCustomerCommunicationOrder(orderId, actor);
  const latestManual = latestManualMarkNotification(order);
  if (!latestManual?.id) {
    throw codedError("当前订单没有可取消的手动发送标记。", 400, "CUSTOMER_COMMUNICATION_MANUAL_MARK_NOT_FOUND");
  }
  const updated = await prisma.shippingDocumentNotification.update({
    where: { id: latestManual.id },
    data: {
      sendStatus: "CANCELLED",
      errorMessage: "手动发送标记已取消",
    },
    include: { sentBy: true },
  });
  await runNonCriticalTask("客户沟通取消手动标记日志写入", () => writeAudit(
    request,
    actor,
    "取消手动标记清关资料已发送",
    "shipping_document_notifications",
    updated.id,
    latestManual,
    {
      orderNo: order.orderNo,
      deliveryMethod: latestManual.deliveryMethod || "",
      sentAt: latestManual.sentAt,
      remark: latestManual.manualRemark || "",
    },
  ));
  return getCustomerCommunicationDetail(orderId, actor);
}
