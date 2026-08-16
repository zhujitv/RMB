"use client";

import { useEffect, useMemo, useState } from "react";
import { apiJson } from "../../api";
import { productionQuantityMaximum, productionQuantityUnits } from "../production-progress-quantity";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import type {
  SupplierPurchaseOrderDetailResponse,
  SupplierPurchaseOrderDto,
} from "./types";

function currentQuantities(detail: SupplierPurchaseOrderDto) {
  return Object.fromEntries(
    detail.productionProgress.items.map((item) => [
      item.purchaseOrderItemId,
      item.completedQuantity,
    ]),
  );
}

function quantity(value: string | number | null | undefined) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function useSupplierProductionProgress({
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
  const initialQuantities = useMemo(() => currentQuantities(detail), [detail]);
  const currentProgressById = useMemo(() => new Map(
    detail.productionProgress.items.map((item) => [item.purchaseOrderItemId, item]),
  ), [detail.productionProgress.items]);
  const [values, setValues] = useState<Record<string, string>>(initialQuantities);
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useWorkspaceTabBusy(submitting);

  useEffect(() => {
    setValues(initialQuantities);
    setRemark("");
    setError("");
  }, [initialQuantities]);

  const validationError = useMemo(() => {
    if (!canWrite || detail.status !== "ACCEPTED" || detail.productionStatus !== "IN_PRODUCTION") {
      return "当前采购单不能填报生产进度";
    }
    let changed = false;
    for (const [index, item] of detail.items.entries()) {
      const value = String(values[item.id] ?? "").trim();
      const completedUnits = productionQuantityUnits(value);
      if (completedUnits === null) {
        return `第 ${index + 1} 行累计完成数量格式错误，最多保留 4 位小数`;
      }
      const progressItem = currentProgressById.get(item.id);
      const previous = progressItem?.completedQuantity || "0";
      const previousUnits = productionQuantityUnits(previous) || BigInt(0);
      const maximumUnits = productionQuantityUnits(productionQuantityMaximum(progressItem?.targetQuantity || item.quantity, previous)) || BigInt(0);
      if (completedUnits < previousUnits) {
        return `第 ${index + 1} 行累计完成数量不能小于上次填报数量`;
      }
      if (completedUnits > maximumUnits) {
        return `第 ${index + 1} 行累计完成数量不能超过当前允许上限`;
      }
      if (completedUnits !== previousUnits) changed = true;
    }
    return changed ? "" : "请至少更新一项累计完成数量";
  }, [canWrite, currentProgressById, detail.items, detail.productionStatus, detail.status, values]);

  const draftPercent = useMemo(() => {
    if (!detail.items.length) return 0;
    const ratio = detail.items.reduce((sum, item) => {
      const total = quantity(currentProgressById.get(item.id)?.targetQuantity || item.quantity);
      return sum + (total > 0 ? Math.min(1, quantity(values[item.id]) / total) : 0);
    }, 0);
    return Number(((ratio / detail.items.length) * 100).toFixed(2));
  }, [currentProgressById, detail.items, values]);

  function setQuantity(itemId: string, value: string) {
    setError("");
    setValues((current) => ({ ...current, [itemId]: value }));
  }

  function fillItem(itemId: string, targetQuantity: string) {
    const previous = currentProgressById.get(itemId)?.completedQuantity || "0";
    setQuantity(itemId, productionQuantityMaximum(targetQuantity, previous));
  }

  function fillAll() {
    setError("");
    setValues(Object.fromEntries(detail.items.map((item) => [
      item.id,
      productionQuantityMaximum(
        currentProgressById.get(item.id)?.targetQuantity || item.quantity,
        currentProgressById.get(item.id)?.completedQuantity || "0",
      ),
    ])));
  }

  async function submit() {
    if (disabled || submitting || validationError) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await apiJson<SupplierPurchaseOrderDetailResponse>(
        `/api/supplier-purchase-orders/${encodeURIComponent(detail.id)}/production-progress`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: detail.revision,
            items: detail.items.map((item) => ({
              purchaseOrderItemId: item.id,
              completedQuantity: String(values[item.id] ?? "").trim(),
            })),
            remark: remark.trim(),
          }),
        },
      );
      const saved = result.purchaseOrder || result.data;
      if (!saved) throw new Error("生产进度提交结果缺失，请刷新后确认");
      onSaved(saved, result.message || "生产进度已提交");
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "提交生产进度失败");
    } finally {
      setSubmitting(false);
    }
  }

  return {
    values,
    remark,
    submitting,
    error,
    validationError,
    draftPercent,
    setQuantity,
    setRemark,
    fillItem,
    fillAll,
    submit,
  };
}
