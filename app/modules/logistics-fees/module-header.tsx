import styles from "../../WorkspaceShell.module.css";

export function LogisticsFeesModuleHeader({
  title,
  canCreateExpense,
  createOpen,
  loading,
  onToggleCreate,
  onRefresh,
}: {
  title: string;
  canCreateExpense: boolean;
  createOpen: boolean;
  loading: boolean;
  onToggleCreate: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className={styles.moduleHeader}>
      <div>
        <h2>{title}</h2>
      </div>
      <div className={styles.headerActions}>
        {canCreateExpense ? (
          <button
            className={styles.primaryButtonCompact}
            type="button"
            onClick={onToggleCreate}
          >
            {createOpen ? "收起登记" : "新增物流费用"}
          </button>
        ) : null}
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "刷新中..." : "刷新"}
        </button>
      </div>
    </div>
  );
}
