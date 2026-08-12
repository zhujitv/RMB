import styles from "./quotation-item-actions.module.css";

export function QuotationItemActions({
  disabled,
  canRemove,
  onDuplicate,
  onRemove,
}: {
  disabled: boolean;
  canRemove: boolean;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.rowActions}>
      <button
        className={styles.copyButton}
        type="button"
        aria-label="复制当前报价行并插入下一行"
        disabled={disabled}
        onClick={onDuplicate}
      >
        复制
      </button>
      <button
        className={styles.removeButton}
        type="button"
        aria-label="移除当前报价行"
        disabled={disabled || !canRemove}
        onClick={onRemove}
      >
        移除
      </button>
    </div>
  );
}
