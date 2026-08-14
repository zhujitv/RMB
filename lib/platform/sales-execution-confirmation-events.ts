type LooseRecord = Record<string, unknown>;

function record(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as LooseRecord : {};
}

export function serializeFactoryConfirmationEvents(
  order: LooseRecord,
  responseHistory: Array<Record<string, unknown>>,
  productionCompletedBy: LooseRecord,
) {
  const completionEvidenceFile = record(order.productionCompletionEvidenceFile);
  const evidenceUploadedBy = record(completionEvidenceFile.uploadedBy);
  const evidencePath = `/api/sales-executions/${encodeURIComponent(String(order.executionId || ""))}/purchase-orders/${encodeURIComponent(String(order.id || ""))}/confirmation-evidence/PRODUCTION_COMPLETION/${encodeURIComponent(String(order.id || ""))}`;
  const completionEvent = order.productionCompletedAt ? {
    key: `production-completion:${String(order.id || "")}`,
    eventId: String(order.id || ""),
    kind: "PRODUCTION_COMPLETION",
    action: "PRODUCTION_COMPLETED",
    source: String(order.productionCompletionSource || "SUPPLIER_PORTAL"),
    channel: String(order.productionCompletionChannel || "PORTAL"),
    supplierContact: String(order.productionCompletionContact || ""),
    occurredAt: order.productionCompletedAt || null,
    recordedAt: order.productionCompletionRecordedAt || order.productionCompletedAt || null,
    recordedBy: productionCompletedBy.id
      ? { id: String(productionCompletedBy.id), name: String(productionCompletedBy.name || "") }
      : null,
    remark: String(order.productionCompletionRemark || ""),
    evidenceNote: String(order.productionCompletionEvidenceNote || ""),
    evidence: completionEvidenceFile.id ? {
      id: String(completionEvidenceFile.id),
      fileName: String(completionEvidenceFile.fileName || "确认凭证"),
      mimeType: String(completionEvidenceFile.mimeType || "application/octet-stream"),
      fileSize: Number(completionEvidenceFile.fileSize || 0),
      uploadedAt: completionEvidenceFile.uploadedAt || null,
      uploadedBy: evidenceUploadedBy.id ? {
        id: String(evidenceUploadedBy.id), name: String(evidenceUploadedBy.name || ""),
      } : null,
      previewUrl: evidencePath,
      downloadUrl: `${evidencePath}?download=1`,
    } : null,
  } : null;
  const confirmationEvents = [
    ...responseHistory.map((response) => ({
      key: `supplier-response:${response.id}`,
      eventId: response.id,
      kind: "SUPPLIER_RESPONSE",
      action: response.action,
      deliveryDate: response.deliveryDate,
      priceChanges: response.priceChanges,
      source: response.source,
      channel: response.channel,
      supplierContact: response.supplierContact,
      occurredAt: response.supplierRespondedAt,
      recordedAt: response.recordedAt,
      recordedBy: response.recordedBy,
      remark: response.remark,
      evidenceNote: response.evidenceNote,
      evidence: response.evidence,
    })),
    ...(completionEvent ? [completionEvent] : []),
  ];
  return { completionEvent, confirmationEvents };
}
