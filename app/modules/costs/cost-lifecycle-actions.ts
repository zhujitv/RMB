import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import { apiJson } from "../../api";
import { moneyText } from "../../formatters";
import type { CostActionsContext } from "./cost-actions-context";
import { recalculateOrderSummary } from "./cost-table";
import { canDeleteCost } from "./helpers";
import type {
  CostBatchVoidResponse,
  CostDeleteResponse,
  CostOrderSummary,
  CostRow,
} from "./model";

export function createCostLifecycleActions(context: CostActionsContext) {
  const {
    setRows, setOrderRows, setDetailCost, setDetailOrderSummary, setCostFormDrawer,
    setDocumentCost, setVoucherPreviewCost, setDeletingId, setError, setNotice,
    costView, page, submittedFilters, archiveScope, loadCosts, requestConfirmation,
  } = context;
  function applyDeletedCost(cost: CostRow, orderSummary?: CostOrderSummary | null) {
    const nextOrderSummary = orderSummary || null;
    setRows((current) => current.filter((item) => item.id !== cost.id));
    setOrderRows((current) => {
      if (nextOrderSummary) {
        const exists = current.some((item) => item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId);
        if (!exists) return current;
        return current.map((item) => (
          item.id === nextOrderSummary.id || item.orderId === nextOrderSummary.orderId
            ? { ...item, ...nextOrderSummary }
            : item
        ));
      }
      return current.map((item) => (
        item.id === cost.orderId || item.orderId === cost.orderId
          ? recalculateOrderSummary(item, item.costs?.filter((row) => row.id !== cost.id) || [])
          : item
      ));
    });
    setDetailOrderSummary((current) => {
      if (!current) return current;
      if (nextOrderSummary && (current.id === nextOrderSummary.id || current.orderId === nextOrderSummary.orderId)) {
        return { ...current, ...nextOrderSummary };
      }
      if (current.id === cost.orderId || current.orderId === cost.orderId) {
        return recalculateOrderSummary(current, current.costs?.filter((row) => row.id !== cost.id) || []);
      }
      return current;
    });
    setDetailCost((current) => current?.id === cost.id ? null : current);
    setDocumentCost((current) => current?.id === cost.id ? null : current);
    setVoucherPreviewCost((current) => current?.id === cost.id ? null : current);
    setCostFormDrawer((current) => current?.cost?.id === cost.id ? null : current);
  }

  function lifecycleDetails(cost: CostRow, actionText: string) {
    return [
      `订单：${cost.orderNo || "-"}`,
      `成本：${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} ${moneyText(cost.currency, cost.amount, cost.amountCny)}`,
      `处理方式：${actionText}`,
      ...(!canDeleteCost(cost) && Array.isArray(cost.deleteBlockedReasons) && cost.deleteBlockedReasons.length
        ? [`不能删除原因：${cost.deleteBlockedReasons.join("；")}`]
        : []),
    ];
  }

  async function voidCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "作废成本",
      message: "确认作废这条成本明细吗？作废后将从成本统计、利润分析、退税计算、待办和报表中排除，但保留金额、附件、付款凭证和操作日志。",
      details: lifecycleDetails(cost, "作废，不做物理删除"),
      confirmLabel: "作废成本",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请填写作废原因",
      inputRequiredMessage: "作废原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ action: "void", reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "作废成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已作废");
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : "作废成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function deleteCost(cost: CostRow) {
    if (!canDeleteCost(cost)) {
      await voidCost(cost);
      return;
    }
    const confirmationResult = await requestConfirmation({
      title: "删除成本",
      message: "确认删除这条成本明细吗？删除后将影响该订单成本合计和利润分析，且不可恢复。",
      details: lifecycleDetails(cost, "物理删除"),
      confirmLabel: "删除成本",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "删除原因",
      inputPlaceholder: "请填写删除原因",
      inputRequiredMessage: "删除原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ action: "delete", reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "删除成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function restoreCost(cost: CostRow) {
    const confirmationResult = await requestConfirmation({
      title: "恢复作废成本",
      message: "确认恢复这条已作废成本吗？恢复后将重新参与成本统计、利润分析、退税完整度、待办和报表。",
      details: lifecycleDetails(cost, "恢复为有效成本"),
      confirmLabel: "恢复成本",
      cancelLabel: "取消",
      variant: "warning",
      requireInput: true,
      inputLabel: "恢复原因",
      inputPlaceholder: "请填写恢复原因",
      inputRequiredMessage: "恢复原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId(cost.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostDeleteResponse>(`/api/costs/${encodeURIComponent(cost.id)}/restore`, {
        method: "POST",
        body: JSON.stringify({ reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "恢复成本失败");
      applyDeletedCost(cost, result.orderSummary);
      setNotice(result.message || "成本明细已恢复");
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "恢复成本失败");
    } finally {
      setDeletingId("");
    }
  }

  async function batchVoidCosts(costs: CostRow[]) {
    const targetCosts = costs.filter((cost) => cost.id);
    if (!targetCosts.length) return;
    const confirmationResult = await requestConfirmation({
      title: "批量作废成本",
      message: `确认作废选中的 ${targetCosts.length} 条成本明细吗？作废后不参与利润、退税、待办和报表。`,
      details: targetCosts.slice(0, 5).map((cost) => `${cost.orderNo || "-"} · ${logisticsCostTypeLabel(cost.costType || "") || cost.costType || "-"} · ${moneyText(cost.currency, cost.amount, cost.amountCny)}`),
      confirmLabel: "批量作废",
      cancelLabel: "取消",
      variant: "danger",
      requireInput: true,
      inputLabel: "作废原因",
      inputPlaceholder: "请填写批量作废原因",
      inputRequiredMessage: "作废原因不能为空。",
    });
    if (!confirmationResult.confirmed) return;
    setDeletingId("__batch_void__");
    setError("");
    setNotice("");
    try {
      const result = await apiJson<CostBatchVoidResponse>("/api/costs/batch-void", {
        method: "POST",
        body: JSON.stringify({ ids: targetCosts.map((cost) => cost.id), reason: confirmationResult.inputValue }),
      });
      if (result.success !== true && result.ok !== true) throw new Error(result.message || "批量作废成本失败");
      const ids = new Set(targetCosts.map((cost) => cost.id));
      setRows((current) => current.filter((row) => !ids.has(row.id)));
      setDetailCost((current) => current && ids.has(current.id) ? null : current);
      setDocumentCost((current) => current && ids.has(current.id) ? null : current);
      void loadCosts(page, submittedFilters, archiveScope, costView, { silent: true });
      setNotice(`已作废 ${result.voidedCount || 0} 条成本${result.skippedCount ? `，跳过 ${result.skippedCount} 条` : ""}`);
    } catch (batchError) {
      setError(batchError instanceof Error ? batchError.message : "批量作废成本失败");
    } finally {
      setDeletingId("");
    }
  }


  return { voidCost, deleteCost, restoreCost, batchVoidCosts };
}
