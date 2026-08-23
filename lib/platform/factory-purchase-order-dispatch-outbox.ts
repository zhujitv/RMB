import { createHash } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { NOTIFICATION_TYPES } from "./notification-definitions";
import { applyTemplate, definitionByType } from "./notification-helpers";
import { productVisibleDescription } from "./quotation-calculations";
import { buildWorkbenchDeepLink } from "./workbench-deep-link";
import { ACTIVE_PURCHASE_ORDER_STATUSES } from "./factory-purchase-order-dispatch-notification-helpers";
import { resolveFactoryPurchaseOrderDispatchRecipients } from "./factory-purchase-order-dispatch-recipients";
import { dispatchAttachmentSnapshotFromAsset } from "./factory-purchase-order-dispatch-attachment-snapshot";
import { FILE_ASSET_ROLES, FILE_ASSET_SOURCE_TABLES } from "./file-asset-data";

function appOrigin() {
  return (
    process.env.NEXT_PUBLIC_APP_URL
    || process.env.APP_URL
    || process.env.APP_BASE_URL
    || "https://www.nextwood.net"
  ).replace(/\/+$/, "");
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function notificationItemLines(items: Array<{
  lineNumber: number;
  productNameSnapshot: string;
  specificationSnapshot: string | null;
  unitSnapshot: string;
  allocatedQuantity: Prisma.Decimal;
}>) {
  const lines = items.map((item) => {
    const description = productVisibleDescription(
      item.productNameSnapshot,
      item.specificationSnapshot,
    );
    return `${item.lineNumber}. ${description} · ${item.allocatedQuantity.toString()} ${item.unitSnapshot}`;
  });
  const maxLength = 8000;
  let result = "";
  for (const line of lines) {
    const next = result ? `${result}\n${line}` : line;
    if (next.length > maxLength) {
      return `${result}\n……其余采购明细请登录平台查看。`;
    }
    result = next;
  }
  return result;
}

export function factoryDispatchRecipientKey(email: string) {
  return createHash("sha256").update(email).digest("hex").slice(0, 20);
}

export function factoryDispatchIdempotencyKey(
  purchaseOrderId: string,
  dispatchVersionNumber: number,
  email: string,
) {
  return `factory-po-dispatch:${purchaseOrderId}:v${dispatchVersionNumber}:${factoryDispatchRecipientKey(email)}`;
}

export async function queueFactoryPurchaseOrderDispatchOutbox(
  tx: Prisma.TransactionClient,
  executionId: string,
  dispatchVersionNumber: number,
  options: { purchaseOrderIds?: string[] } = {},
) {
  const definition = definitionByType(NOTIFICATION_TYPES.FACTORY_PURCHASE_ORDER_DISPATCH);
  if (!definition) throw new Error("工厂采购单通知模板定义不存在");
  const orders = await tx.factoryPurchaseOrder.findMany({
    where: {
      executionId,
      dispatchVersionNumber,
      status: { in: [...ACTIVE_PURCHASE_ORDER_STATUSES] },
      ...(options.purchaseOrderIds?.length ? { id: { in: options.purchaseOrderIds } } : {}),
    },
    include: {
      execution: { select: { executionNo: true, businessEntityNameSnapshot: true } },
      items: { orderBy: [{ lineNumber: "asc" }] },
    },
  });
  const attachmentAssets = orders.length ? await tx.fileAsset.findMany({
    where: {
      sourceTable: FILE_ASSET_SOURCE_TABLES.FACTORY_PURCHASE_ORDERS,
      sourceId: { in: orders.map((order) => order.id) },
      fileRole: FILE_ASSET_ROLES.PURCHASE_ORDER_ORIGINAL_DETAIL,
      isDeleted: false,
      deletedAt: null,
    },
  }) : [];
  const attachmentByPurchaseOrderId = new Map(attachmentAssets.map((asset) => [asset.sourceId, asset]));
  const outboxRows: Prisma.NotificationOutboxCreateManyInput[] = [];
  const purchaseOrderIds: string[] = [];
  const attachmentSnapshots: Array<{
    purchaseOrderId: string;
    assetId: string;
    sha256: string;
    size: number;
    mimeType: string;
    fileName: string;
  }> = [];
  let missingRecipient = 0;
  for (const order of orders) {
    purchaseOrderIds.push(order.id);
    const attachmentAsset = attachmentByPurchaseOrderId.get(order.id);
    const dispatchAttachment = attachmentAsset ? dispatchAttachmentSnapshotFromAsset(attachmentAsset) : null;
    if (dispatchAttachment) attachmentSnapshots.push({ purchaseOrderId: order.id, ...dispatchAttachment });
    const { recipientEmails, blockedReason } =
      await resolveFactoryPurchaseOrderDispatchRecipients(tx, order.supplierId);
    const variables = {
      supplierName: order.supplierNameSnapshot,
      poNo: order.poNo,
      requestedDeliveryDate: formatDate(order.requestedDeliveryDate),
      purchaseCurrency: order.purchaseCurrency,
      itemLines: notificationItemLines(order.items),
      actionUrl: buildWorkbenchDeepLink(
        appOrigin(),
        `/supplier-purchase-orders?purchaseOrderId=${encodeURIComponent(order.id)}`,
      ) || appOrigin(),
      companyName: order.execution.businessEntityNameSnapshot,
    };
    if (["SENT", "SENDING"].includes(order.dispatchEmailStatus || "")) continue;
    if (!recipientEmails.length) {
      missingRecipient += 1;
      await tx.factoryPurchaseOrder.updateMany({
        where: { id: order.id, dispatchEmailStatus: { not: "SENT" } },
        data: {
          dispatchEmailStatus: "NO_RECIPIENT",
          dispatchRecipientEmails: [],
          dispatchEmailError: blockedReason,
        },
      });
      continue;
    }
    await tx.factoryPurchaseOrder.updateMany({
      where: { id: order.id, dispatchEmailStatus: { not: "SENT" } },
      data: {
        dispatchEmailStatus: "NOT_SENT",
        dispatchRecipientEmails: recipientEmails,
        dispatchEmailError: null,
      },
    });
    for (const recipientEmail of recipientEmails) {
      outboxRows.push({
        type: definition.type,
        channel: "EMAIL",
        idempotencyKey: factoryDispatchIdempotencyKey(order.id, dispatchVersionNumber, recipientEmail),
        status: "queued",
        recipientEmails: [recipientEmail],
        ccEmails: [],
        subject: applyTemplate(definition.subjectTemplate, variables),
        body: applyTemplate(definition.bodyTemplate, variables),
        context: {
          variables,
          executionId,
          executionNo: order.execution.executionNo,
          dispatchVersionNumber,
          dispatchAttachment,
        },
        attachments: dispatchAttachment ? [{
          assetId: dispatchAttachment.assetId,
          filename: dispatchAttachment.fileName,
          contentType: dispatchAttachment.mimeType,
          size: dispatchAttachment.size,
          sha256: dispatchAttachment.sha256,
        }] : undefined,
        relatedEntityType: "factory_purchase_order",
        relatedEntityId: order.id,
      });
    }
  }
  const created = outboxRows.length
    ? await tx.notificationOutbox.createMany({ data: outboxRows, skipDuplicates: true })
    : { count: 0 };
  return {
    total: orders.length,
    queued: created.count,
    missingRecipient,
    purchaseOrderIds,
    attachmentSnapshots,
  };
}
