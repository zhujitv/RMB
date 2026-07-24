import { useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../../workspace/workspace-tab-context";
import type {
  CostFilters,
  CostFormDrawerState,
  CostInvoiceGroupRow,
  CostOrderSummary,
  CostRow,
  CostView,
} from "./model";

type CostWorkspacePresentationParams = {
  costFormDrawer: CostFormDrawerState | null;
  documentCost: CostRow | null;
  detailCost: CostRow | null;
  detailOrderSummary: CostOrderSummary | null;
  detailInvoiceGroup: CostInvoiceGroupRow | null;
  page: number;
  submittedFilters: CostFilters;
  archiveScope: string;
  costView: CostView;
  loadCosts: (
    page?: number,
    filters?: CostFilters,
    archiveScope?: string,
    view?: CostView,
  ) => Promise<void>;
};

export function useCostWorkspacePresentation(params: CostWorkspacePresentationParams) {
  const {
    costFormDrawer, documentCost, detailCost, detailOrderSummary, detailInvoiceGroup,
    page, submittedFilters, archiveScope, costView, loadCosts,
  } = params;
  const workspaceCost = costFormDrawer?.cost || documentCost || detailCost;
  const workspaceCostTitle = workspaceCost?.orderNo || workspaceCost?.blNo || workspaceCost?.id || "详情";
  useWorkspaceTabPresentation({
    title: costFormDrawer
      ? `${costFormDrawer.mode === "edit" ? "编辑" : costFormDrawer.mode === "copy" ? "复制" : "新建"}成本${workspaceCost ? ` · ${workspaceCostTitle}` : ""}`
      : documentCost ? `成本资料 · ${workspaceCostTitle}`
        : detailCost ? `成本 · ${workspaceCostTitle}`
          : detailOrderSummary ? `订单成本 · ${detailOrderSummary.orderNo || "详情"}`
            : detailInvoiceGroup ? `发票组 · ${detailInvoiceGroup.orderNo || detailInvoiceGroup.id}`
              : "成本管理",
    view: costFormDrawer || documentCost
      ? "edit" : detailCost || detailOrderSummary || detailInvoiceGroup ? "detail" : "list",
    contextKey: costFormDrawer
      ? `${costFormDrawer.mode}:${costFormDrawer.cost?.id || "new"}`
      : documentCost ? `documents:${documentCost.id}:${documentCost.updatedAt || documentCost.costType || "current"}`
        : detailCost ? `detail:${detailCost.id}`
          : detailOrderSummary ? `order:${detailOrderSummary.orderId || detailOrderSummary.orderNo || "summary"}`
            : detailInvoiceGroup ? `invoice:${detailInvoiceGroup.id}` : "list:costs",
    ensureListTab: Boolean(
      costFormDrawer || documentCost || detailCost || detailOrderSummary || detailInvoiceGroup,
    ),
  });
  useWorkspaceTabReactivation(() => {
    void loadCosts(page, submittedFilters, archiveScope, costView);
  });
}
