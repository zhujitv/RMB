// @ts-nocheck
import { prisma } from "../prisma";
import { assertRead, assertWrite, permissionError, runNonCriticalTask, writeAudit } from "./shared";
import { canAccessOrder } from "./order-access";

function normalizeAttachmentRelatedType(value) {
  const type = String(value || "").trim();
  return {
    orders: "receivable_orders",
    receivableOrder: "receivable_orders",
    receivable_orders: "receivable_orders",
    payments: "payments",
    payment: "payments",
    order_costs: "order_costs",
    costs: "order_costs",
    cost: "order_costs",
  }[type] || type;
}

async function assertAttachmentScope(actor, relatedTypeInput, relatedId, mode = "read") {
  const relatedType = normalizeAttachmentRelatedType(relatedTypeInput);
  if (!relatedId) throw permissionError("关联 ID 不能为空", 400);
  if (relatedType === "receivable_orders") {
    if (mode === "read") assertRead(actor, "orders");
    if (mode === "write") assertWrite(actor, "orders");
    const order = await prisma.receivableOrder.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { customer: true, costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } },
    });
    if (!order) throw permissionError("关联订单不存在", 404);
    if (!canAccessOrder(actor, order)) throw permissionError("无权限访问该订单附件");
    return { relatedType, relatedId };
  }
  if (relatedType === "payments") {
    if (mode === "read") assertRead(actor, "payments");
    if (mode === "write") assertWrite(actor, "payments");
    const payment = await prisma.payment.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { order: { include: { customer: true, costs: { where: { deletedAt: null }, select: { createdById: true, deletedAt: true } } } } },
    });
    if (!payment) throw permissionError("关联收款不存在", 404);
    if (!canAccessOrder(actor, payment.order)) throw permissionError("无权限访问该收款附件");
    return { relatedType, relatedId };
  }
  if (relatedType === "order_costs") {
    if (mode === "read") assertRead(actor, "costs");
    if (mode === "write") assertWrite(actor, "costs");
    const cost = await prisma.orderCost.findFirst({
      where: { id: relatedId, deletedAt: null },
      include: { order: { include: { customer: true } } },
    });
    if (!cost) throw permissionError("关联成本不存在", 404);
    if (actor.role === "成本录入员" && cost.createdById !== actor.id) throw permissionError("只能访问自己录入成本的附件");
    if (actor.role !== "成本录入员" && !canAccessOrder(actor, cost.order)) throw permissionError("无权限访问该成本附件");
    return { relatedType, relatedId };
  }
  throw permissionError("不支持的附件关联类型", 400);
}

export async function listAttachments(query, actor) {
  const relatedTypeInput = query.get("relatedType") || "";
  const relatedId = query.get("relatedId") || "";
  const { relatedType } = await assertAttachmentScope(actor, relatedTypeInput, relatedId, "read");
  return prisma.attachment.findMany({
    where: { deletedAt: null, relatedType, relatedId },
    include: { uploadedBy: true },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function saveAttachment(request, actor, input) {
  assertWrite(actor, "attachments");
  const error = new Error("旧手动附件接口已停用，请使用 PDF 上传接口。");
  error.status = 410;
  error.code = "LEGACY_ATTACHMENT_API_DISABLED";
  throw error;
}

export async function deleteAttachment(request, actor, id) {
  assertWrite(actor, "attachments");
  const before = await prisma.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw permissionError("附件不存在或已删除", 404);
  await assertAttachmentScope(actor, before.relatedType, before.relatedId, "write");
  const row = await prisma.attachment.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  await runNonCriticalTask("附件删除操作日志写入", () => writeAudit(request, actor, "删除附件", "attachments", id, before, row));
  return row;
}
