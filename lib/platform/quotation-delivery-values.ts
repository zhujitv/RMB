type LooseRecord = Record<string, unknown>;

function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

export function serializeQuotationDelivery(value: unknown) {
  const delivery = asRecord(value);
  const sentBy = asRecord(delivery.sentBy);
  return {
    id: String(delivery.id || ""),
    quotationId: String(delivery.quotationId || ""),
    quotationVersionId: String(delivery.quotationVersionId || ""),
    status: String(delivery.status || "PENDING"),
    recipientEmails: stringList(delivery.recipientEmails),
    ccEmails: stringList(delivery.ccEmails),
    subject: String(delivery.subject || ""),
    body: String(delivery.body || ""),
    attachmentFileAssetId: delivery.attachmentFileAssetId ? String(delivery.attachmentFileAssetId) : null,
    attachmentFileName: String(delivery.attachmentFileName || ""),
    outboxId: delivery.outboxId ? String(delivery.outboxId) : null,
    attempts: Number(delivery.attempts || 0),
    lastError: String(delivery.lastError || ""),
    sentBy: sentBy.id ? { id: String(sentBy.id), name: String(sentBy.name || "") } : null,
    sentAt: delivery.sentAt || null,
    failedAt: delivery.failedAt || null,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };
}
