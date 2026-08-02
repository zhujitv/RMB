import * as customsDeclarationParser from "../customs-declaration-parser";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import { orderAccessWhere } from "./order-access";
import {
  DEFAULT_SHIPPING_DOCUMENT_TYPES,
  SHIPPING_DOCUMENT_TYPE_CONFIG,
  assertWrite,
  customerFullName,
  includeOrderRelations,
  nonEmpty,
  normalizeShippingDocumentTypes,
  parseEmailList,
  permissionError,
  writeAudit,
} from "./shared";

export type ActorLike = {
  id?: string | null;
  role?: string | null;
  supplierId?: string | null;
  customPermissions?: unknown;
} | null | undefined;
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export type ShippingCustomerLike = {
  country?: string | null;
  contactEmail?: string | null;
  shippingDocsEmails?: unknown;
  shippingDocsCcEmails?: unknown;
  autoSendDocumentTypes?: unknown;
  clearanceEmailLanguage?: string | null;
  enableAutoShippingDocsNotification?: boolean | null;
  shortName?: string | null;
  name?: string | null;
};
export type ShippingDocumentLike = {
  id?: string;
  documentType?: string | null;
  uploadStatus?: string | null;
  deletedAt?: Date | string | null;
  mimeType?: string | null;
  uploadedAt?: Date | string | null;
  createdAt?: Date | string | null;
  storageKey?: string | null;
  originalFilename?: string | null;
  originalName?: string | null;
  fileName?: string | null;
};
export type ShippingNotificationLike = {
  id?: string;
  sendMode?: string | null;
  sendStatus?: string | null;
  createdAt?: Date | string | null;
};
export type ShippingOrderLike = {
  id?: string;
  customerId?: string | null;
  customer?: ShippingCustomerLike | null;
  documents?: ShippingDocumentLike[] | null;
  shippingDocumentNotifications?: ShippingNotificationLike[] | null;
  country?: string | null;
  blNo?: string | null;
  billOfLadingNo?: string | null;
  customsDeclarationDate?: Date | null;
  orderNo?: string | null;
  customerNameSnapshot?: string | null;
  customsDeclarationParseSource?: string | null;
  customsParseStatus?: string | null;
};
export type ShippingBundleItem = {
  typeKey: string;
  label: string;
  emailLabel: string;
  documentType: string;
  document: ShippingDocumentLike | null;
};
export type ShippingBundle = {
  documentTypes: string[];
  items: ShippingBundleItem[];
  documents: ShippingDocumentLike[];
  missing: ShippingBundleItem[];
};
export type EmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};
export type SendShippingDocumentsEmailInput = {
  recipientEmails: string[];
  ccEmails: string[];
  attachments: EmailAttachment[];
  subject: string;
  body: string;
  notificationId?: string | null;
};
export type ManualShippingEmailInput = Record<string, unknown>;
export type RenderedShippingEmail = {
  language: string;
  type: string;
  subject: string;
  body: string;
  variables: Record<string, unknown>;
};
export type NotificationRecordOptions = {
  sentById?: string;
  documentTypes?: string[];
  emailLanguage?: string;
  emailSubject?: string;
  emailBody?: string;
};
export type ShippingBundleItemWithDocument = ShippingBundleItem & {
  document: ShippingDocumentLike & { storageKey: string };
};

const CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE: Prisma.ReceivableOrderWhereInput = {
  customer: {
    is: {
      enableAutoShippingDocsNotification: true,
      deletedAt: null,
    },
  },
};

export function customerCommunicationEnabledOrderWhere(where: Prisma.ReceivableOrderWhereInput): Prisma.ReceivableOrderWhereInput {
  return { AND: [where, CUSTOMER_COMMUNICATION_ENABLED_ORDER_WHERE] };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "";
}

export function hasShippingDocument(item: ShippingBundleItem): item is ShippingBundleItemWithDocument {
  return Boolean(item.document?.storageKey);
}

export function selectedShippingDocumentTypes(customer: ShippingCustomerLike = {}) {
  return normalizeShippingDocumentTypes(customer.autoSendDocumentTypes);
}

export function shippingRecipientEmails(customer: ShippingCustomerLike = {}) {
  const configured = parseEmailList(customer.shippingDocsEmails || []);
  return configured.length ? configured : parseEmailList(customer.contactEmail || "");
}

export function latestSuccessfulDocumentByType(order: ShippingOrderLike = {}, documentType = "") {
  return (order.documents || [])
    .filter((document) => (
      document.documentType === documentType
      && document.uploadStatus === "SUCCESS"
      && !document.deletedAt
      && String(document.mimeType || "").toLowerCase() === "application/pdf"
    ))
    .sort((a, b) => new Date(b.uploadedAt || b.createdAt || 0).getTime() - new Date(a.uploadedAt || a.createdAt || 0).getTime())[0] || null;
}

export function shippingDocumentBundle(order: ShippingOrderLike = {}, options: { documentTypes?: unknown } = {}): ShippingBundle {
  const customer = order.customer || {};
  const documentTypes = normalizeShippingDocumentTypes(options.documentTypes || selectedShippingDocumentTypes(customer));
  const configMap = SHIPPING_DOCUMENT_TYPE_CONFIG as Record<string, Omit<ShippingBundleItem, "typeKey" | "document">>;
  const items = documentTypes.filter((typeKey) => Boolean(configMap[typeKey])).map((typeKey) => {
    const config = configMap[typeKey];
    const document = latestSuccessfulDocumentByType(order, config.documentType);
    return { typeKey, ...config, document };
  });
  return {
    documentTypes,
    items,
    documents: items.map((item) => item.document).filter((document): document is ShippingDocumentLike => Boolean(document)),
    missing: items.filter((item) => !item.document),
  };
}

export function shippingDocumentManualBundle(order: ShippingOrderLike = {}) {
  return shippingDocumentBundle(order, { documentTypes: DEFAULT_SHIPPING_DOCUMENT_TYPES });
}

export function latestShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0] || null;
}

export function hasSentShippingNotification(order: ShippingOrderLike = {}) {
  return (order.shippingDocumentNotifications || []).some((item) => (
    item.sendStatus === "sent" || item.sendStatus === "SUCCESS"
  ));
}

export function customsDocumentsConfirmed(order: ShippingOrderLike = {}) {
  return order.customsDeclarationParseSource === customsDeclarationParser.CUSTOMS_DECLARATION_PARSE_SOURCE_MANUAL
    || order.customsParseStatus === "MANUAL";
}

export async function loadOrderForShippingNotification(orderId: string, actor: ActorLike = null) {
  const order = await prisma.receivableOrder.findFirst({
    where: {
      id: orderId,
      deletedAt: null,
      ...(actor ? orderAccessWhere(actor) : {}),
    },
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权查看", 404);
  return order;
}

export async function loadOrderForManualShippingNotification(orderId: string, actor: ActorLike = null) {
  assertWrite(actor, "customerCommunication");
  const order = await prisma.receivableOrder.findFirst({
    where: customerCommunicationEnabledOrderWhere({
      id: orderId,
      deletedAt: null,
      ...customerCommunicationOrderAccessWhere(actor),
    }),
    include: includeOrderRelations(),
  });
  if (!order) throw permissionError("订单不存在或无权发送清关资料", 404);
  return order;
}

export function customerCommunicationOrderAccessWhere(actor: ActorLike = null) {
  const actorRole = String(actor?.role || "");
  if (actorRole === "管理员" || actorRole === "物流资料录入员") return {};
  if (actorRole === "业务员") return orderAccessWhere(actor);
  if (actorRole === "物流供应商") {
    const supplierId = nonEmpty(actor?.supplierId);
    return supplierId ? { logisticsSuppliers: { some: { supplierId } } } : { id: "__no_customer_communication_access__" };
  }
  return orderAccessWhere(actor);
}
