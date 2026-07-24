import { SideDetailDrawer } from "../../components";
import { customerDisplayName } from "../../utils";
import { useWorkspaceTabDiscardGuard } from "../../workspace/workspace-tab-context";
import { logisticsCostTypeLabel } from "../../../lib/platform/logistics-cost-types";
import type { CostFormDrawerState, CostRow } from "./model";
import { QuickCreateCostPanel } from "./quick-create-cost-panel";

export { QuickCreateCostPanel };

export function CostFormDrawer({
  drawer,
  canManageFactoryPayments,
  onCancel,
  onSaved,
}: {
  drawer: CostFormDrawerState;
  canManageFactoryPayments: boolean;
  onCancel: () => void;
  onSaved: (saved?: CostRow | CostRow[] | null) => void | Promise<void>;
}) {
  const cost = drawer.cost;
  const editMode = drawer.mode === "edit";
  const copyMode = drawer.mode === "copy";
  const confirmDiscardCostEdit = useWorkspaceTabDiscardGuard("当前成本内容尚未保存，确定放弃吗？");
  const requestCancel = () => {
    if (confirmDiscardCostEdit()) onCancel();
  };
  const supplierName = cost ? (cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-") : "-";
  const title = editMode
    ? `${cost?.orderNo || "-"} · ${customerDisplayName(cost || {})}`
    : copyMode
      ? `复制成本 · ${cost?.orderNo || "-"}`
    : "登记成本";
  const subtitle = editMode
    ? `成本类型：${logisticsCostTypeLabel(cost?.costType || "") || cost?.costType || "-"} · 付款状态：${cost?.paymentStatus || "-"} · 供应商：${supplierName}`
    : copyMode
      ? `将以 ${supplierName} 的成本信息创建一条新成本，附件和付款凭证不会复制。`
    : "选择订单后登记供应商成本，保存后当前筛选和页码保持不变。";

  return (
    <SideDetailDrawer
      ariaLabel={editMode ? "编辑成本" : copyMode ? "复制成本" : "登记成本"}
      kicker="成本管理"
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
    >
      <QuickCreateCostPanel
        drawerMode
        initialCost={cost}
        canManageFactoryPayments={canManageFactoryPayments}
        onCancel={requestCancel}
        onSaved={onSaved}
      />
    </SideDetailDrawer>
  );
}
