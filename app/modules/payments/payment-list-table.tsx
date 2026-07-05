import { PaginationBar } from "../../components";
import styles from "../../WorkspaceShell.module.css";
import { PaymentTableRows } from "./payment-table-rows";
import type { PaymentRow } from "./types";

export function PaymentListTable({
  payments,
  loading,
  total,
  page,
  totalPages,
  onPage,
  onViewDetail,
}: {
  payments: PaymentRow[];
  loading: boolean;
  total: number;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  onViewDetail: (payment: PaymentRow) => void;
}) {
  return (
    <>
      <div className={`${styles.tableWrap} ${styles.tablePinnedTwoCols}`}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th className={styles.orderNoColumn}>订单号</th>
              <th className={styles.customerColumn}>客户简称</th>
              <th>收款日期</th>
              <th>收款类型</th>
              <th className={styles.amountColumn}>金额</th>
              <th>状态</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>数据加载中...</div></td>
              </tr>
            ) : payments.length ? payments.map((payment) => (
              <PaymentTableRows
                key={payment.id}
                payment={payment}
                onViewDetail={() => onViewDetail(payment)}
              />
            )) : (
              <tr>
                <td colSpan={7}><div className={styles.emptyState}>未找到匹配的收款明细</div></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} onPage={onPage} />
    </>
  );
}
