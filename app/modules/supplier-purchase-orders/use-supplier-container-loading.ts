"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabBusy } from "../../workspace/workspace-tab-context";
import {
  containerQuantitiesEqual,
  containerQuantityRemaining,
  containerQuantityWithin,
  type ContainerLoadingReason,
} from "../container-load";
import type { SupplierPurchaseOrderDetailResponse, SupplierPurchaseOrderDto } from "./types";

export type SupplierContainerLoad = SupplierPurchaseOrderDto["containerLoads"][number];

export function useSupplierContainerLoading({ canWrite, detail, load, disabled, onSaved }: {
  canWrite: boolean;
  detail: SupplierPurchaseOrderDto;
  load: SupplierContainerLoad;
  disabled: boolean;
  onSaved: (saved: SupplierPurchaseOrderDto, message: string) => void;
}) {
  const allocations = load.allocations;
  const progressById = useMemo(() => new Map(detail.productionProgress.items.map((item) => [item.purchaseOrderItemId, item])), [detail.productionProgress.items]);
  const approvedByItem = useMemo(() => {
    const values = new Map<string, string[]>();
    for (const container of detail.containerLoads || []) {
      if (container.status === "VOIDED") continue;
      for (const result of container.loadingResults) {
        if (result.status !== "APPROVED") continue;
        for (const item of result.items) {
          values.set(item.purchaseOrderItemId, [...(values.get(item.purchaseOrderItemId) || []), item.loadedQuantity]);
        }
      }
    }
    return values;
  }, [detail.containerLoads]);
  const defaults = useMemo(() => Object.fromEntries(allocations.map((row) => [row.purchaseOrderItemId, row.plannedQuantity])), [allocations]);
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [reason, setReason] = useState<ContainerLoadingReason>("EXACT");
  const [reasonDetail, setReasonDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);
  useWorkspaceTabBusy(submitting);

  useEffect(() => { setValues(defaults); setReason("EXACT"); setReasonDetail(""); setError(""); }, [defaults]);
  const history = load.loadingResults;
  const active = history.find((result) => result.status === "PENDING" || result.status === "APPROVED");
  const eligible = canWrite && load.status === "OPEN" && detail.status === "ACCEPTED" && detail.productionStatus === "COMPLETED" && Boolean(load.loadingDate) && !active;
  const validationError = useMemo(() => {
    if (!eligible) return active?.status === "PENDING" ? "本柜实装差异正在等待内部审批" : active?.status === "APPROVED" ? "本柜实装结果已经确认" : "当前不能填报该柜实装结果";
    let differs = false;
    for (const [index, allocation] of allocations.entries()) {
      const approved = approvedByItem.get(allocation.purchaseOrderItemId) || [];
      const target = progressById.get(allocation.purchaseOrderItemId)?.targetQuantity || detail.items.find((item) => item.id === allocation.purchaseOrderItemId)?.quantity || "0";
      const maximum = containerQuantityRemaining(target, approved);
      const loaded = String(values[allocation.purchaseOrderItemId] || "").trim();
      if (!containerQuantityWithin(loaded, maximum, true)) return `第 ${index + 1} 行实装数量格式错误或超过剩余可装数量`;
      if (!containerQuantitiesEqual(loaded, allocation.plannedQuantity)) differs = true;
    }
    if (differs && reason === "EXACT") return "实装数量与本柜计划不同，请选择限重、限容或其它原因";
    if (!differs && reason !== "EXACT") return "实装数量与本柜计划一致，请选择“按本柜计划装柜”";
    if (differs && !reasonDetail.trim()) return "实装数量有差异时必须填写说明";
    return "";
  }, [active?.status, allocations, approvedByItem, detail.items, eligible, progressById, reason, reasonDetail, values]);

  function setQuantity(itemId: string, value: string) {
    setError("");
    setValues((current) => ({ ...current, [itemId]: value }));
  }

  async function submit() {
    if (disabled || submittingRef.current || validationError) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const response = await apiJson<{ message?: string }>(`/api/supplier-purchase-orders/${encodeURIComponent(detail.id)}/loading-result`, {
        method: "POST",
        body: JSON.stringify({ containerLoadId: load.id, expectedRevision: load.revision, loadingDate: load.loadingDate?.slice(0, 10), reason, reasonDetail: reasonDetail.trim(), items: allocations.map((row) => ({ purchaseOrderItemId: row.purchaseOrderItemId, loadedQuantity: String(values[row.purchaseOrderItemId] || "").trim() })) }),
      });
      const refreshed = await apiJson<SupplierPurchaseOrderDetailResponse>(`/api/supplier-purchase-orders/${encodeURIComponent(detail.id)}`);
      const saved = refreshed.purchaseOrder || refreshed.data;
      if (!saved) throw new Error("实装结果已提交，但刷新采购单失败，请手动刷新确认");
      onSaved(saved, response.message || "本柜实装结果已提交");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交本柜实装结果失败");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return { allocations, progressById, approvedByItem, values, reason, reasonDetail, submitting, error, history, active, eligible, validationError, setQuantity, setReason, setReasonDetail, submit };
}
