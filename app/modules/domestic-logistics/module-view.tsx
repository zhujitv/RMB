import { ConfirmationDialog } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { ShipsgoControlTowerView } from "./control-tower";
import { DomesticLogisticsListView } from "./domestic-logistics-list-view";
import type { DomesticLogisticsModuleViewProps } from "./module-view-types";

export function DomesticLogisticsModuleView(props: DomesticLogisticsModuleViewProps) {
  const {
    loading, activeLogisticsView, shipsgoFeatures, editingOrderId,
    canViewShipsgoControlTower, canManageShipsgoTracking, initialKeyword,
    initialOpenToken, initialControlTowerFullscreen, controlTowerSyncingId,
    confirmation, setNotice, setEditingOrderId, setActiveLogisticsView,
    setControlTowerSyncingId, confirmDiscardEdit, loadRows, openControlTowerOrder,
    cancelConfirmation, confirmConfirmation, updateConfirmationInput,
  } = props;
  return (
    <>
      <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
        <div className={styles.moduleHeader}>
          <div><h2>物流信息</h2></div>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={loading}
            onClick={() => {
              if (editingOrderId && !confirmDiscardEdit()) return;
              if (editingOrderId) setEditingOrderId("");
              setNotice("");
              void loadRows();
            }}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>

        <div className={styles.moduleViewTabs} role="tablist" aria-label="物流信息视图">
          <button
            className={activeLogisticsView === "list" ? styles.moduleViewTabActive : styles.moduleViewTab}
            type="button"
            role="tab"
            aria-selected={activeLogisticsView === "list"}
            disabled={Boolean(controlTowerSyncingId)}
            title={controlTowerSyncingId ? "运输状态正在同步，请完成后再切换视图" : undefined}
            onClick={() => setActiveLogisticsView("list")}
          >
            物流列表
          </button>
          {canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
            <button
              className={activeLogisticsView === "controlTower" ? styles.moduleViewTabActive : styles.moduleViewTab}
              type="button"
              role="tab"
              aria-selected={activeLogisticsView === "controlTower"}
              onClick={() => {
                if (editingOrderId && !confirmDiscardEdit()) return;
                setEditingOrderId("");
                setActiveLogisticsView("controlTower");
              }}
            >
              运输监控
            </button>
          ) : null}
        </div>

        {activeLogisticsView === "controlTower" && canViewShipsgoControlTower && shipsgoFeatures.enabled && shipsgoFeatures.oceanTrackingEnabled ? (
          <ShipsgoControlTowerView
            features={shipsgoFeatures}
            canManage={canManageShipsgoTracking}
            initialKeyword={initialKeyword}
            initialOpenToken={initialOpenToken}
            initialFullScreen={initialControlTowerFullscreen}
            syncingId={controlTowerSyncingId}
            onSyncingChange={setControlTowerSyncingId}
            onOpenOrder={openControlTowerOrder}
          />
        ) : <DomesticLogisticsListView {...props} />}
      </section>
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={cancelConfirmation}
          onConfirm={confirmConfirmation}
          onInputChange={updateConfirmationInput}
        />
      ) : null}
    </>
  );
}
