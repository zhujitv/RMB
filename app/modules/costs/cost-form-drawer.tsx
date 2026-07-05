import { SideDetailDrawer } from "../../components";
import { customerDisplayName } from "../../utils";
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
  const supplierName = cost ? (cost.supplierName || cost.supplierNameSnapshot || cost.vendorName || "-") : "-";
  const title = editMode
    ? `${cost?.orderNo || "-"} · ${customerDisplayName(cost || {})}`
    : "登记成本";
  const subtitle = editMode
    ? `成本类型：${logisticsCostTypeLabel(cost?.costType || "") || cost?.costType || "-"} · 付款状态：${cost?.paymentStatus || "-"} · 供应商：${supplierName}`
    : "选择订单后登记供应商成本，保存后当前筛选和页码保持不变。";

  return (
    <SideDetailDrawer
      ariaLabel={editMode ? "编辑成本" : "登记成本"}
      kicker="成本管理"
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
    >
      <QuickCreateCostPanel
        drawerMode
        initialCost={cost}
        canManageFactoryPayments={canManageFactoryPayments}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    </SideDetailDrawer>
  );
}
