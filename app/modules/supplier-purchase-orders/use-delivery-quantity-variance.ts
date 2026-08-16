"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  quantitiesEqual,
  quantityWithinTolerance,
} from "../delivery-quantity-variance";
import { productionQuantityUnits } from "../production-progress-quantity";
import type {
  SupplierPurchaseOrderDetailResponse,
  SupplierPurchaseOrderDto,
} from "./types";

function initialValues(detail: SupplierPurchaseOrderDto) {
  return Object.fromEntries(detail.items.map((item) => [item.id, item.quantity]));
}

export function useDeliveryQuantityVariance({
  canWrite,
  detail,
  disabled,
  onSaved,
}: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const defaults = useMemo(() => initialValues(detail), [detail]);
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useWorkspaceTabBusy(submitting);

  useEffect(() => {
    setValues(defaults);
    setReason("");
    setError("");
  }, [defaults]);

  const history = detail.deliveryQuantityVariances;
  const active = history.find((entry) => entry.status === "PENDING" || entry.status === "APPROVED");
  const eligible = canWrite
    && detail.status === "ACCEPTED"
    && detail.productionStatus === "IN_PRODUCTION"
    && !detail.actualDeliveryDate
    && !active;
  const tolerance = detail.deliveryQuantityToleranceRatio;
  const validationError = useMemo(() => {
    if (!eligible) return active?.status === "PENDING" ? "已有申请待审批" : active?.status === "APPROVED" ? "已有批准的数量差异" : "当前采购单不能申请数量差异";
    let changed = false;
    for (const [index, item] of detail.items.entries()) {
      const proposed = String(values[item.id] ?? "").trim();
      const units = productionQuantityUnits(proposed);
      if (units === null || units <= BigInt(0)) return `第 ${index + 1} 行拟交付数量格式错误`;
      if (!quantityWithinTolerance(item.quantity, proposed, tolerance)) return `第 ${index + 1} 行超出本采购单允许的数量公差`;
      if (!quantitiesEqual(item.quantity, proposed)) changed = true;
    }
    if (!changed) return "请至少调整一项拟交付数量";
    if (!reason.trim()) return "请填写数量差异原因";
    return "";
  }, [active?.status, detail.items, eligible, reason, tolerance, values]);

  function setQuantity(itemId: string, value: string) {
    setError("");
    setValues((current) => ({ ...current, [itemId]: value }));
  }

  async function submit() {
    if (disabled || submitting || validationError) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await apiJson<{ message?: string }>(
        `/api/supplier-purchase-orders/${encodeURIComponent(detail.id)}/quantity-variance`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: detail.revision,
            reason: reason.trim(),
            items: detail.items.map((item) => ({
              purchaseOrderItemId: item.id,
              proposedQuantity: String(values[item.id] ?? "").trim(),
            })),
          }),
        },
      );
      const refreshed = await apiJson<SupplierPurchaseOrderDetailResponse>(
        `/api/supplier-purchase-orders/${encodeURIComponent(detail.id)}`,
      );
      const saved = refreshed.purchaseOrder || refreshed.data;
      if (!saved) throw new Error("申请已提交，但刷新采购单失败，请手动刷新确认");
      onSaved(saved, response.message || "交付数量差异申请已提交，等待内部审批");
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "提交交付数量差异申请失败");
    } finally {
      setSubmitting(false);
    }
  }

  return {
    values,
    reason,
    history,
    active,
    eligible,
    submitting,
    error,
    tolerance,
    validationError,
    setQuantity,
    setReason,
    submit,
  };
}
