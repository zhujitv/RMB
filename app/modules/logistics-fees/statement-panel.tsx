import type { Dispatch, SetStateAction } from "react";
import styles from "../../WorkspaceShell.module.css";
import type { LogisticsStatementRow } from "./model";
import {
  MonthlySummaryComponent,
  SupplierSectionComponent,
} from "./monthly-summary";

export function LogisticsFeesStatementPanel({
  statementMonth,
  setStatementMonth,
  statementRows,
  statementLoading,
  loadStatement,
  exportStatementCsv,
}: {
  statementMonth: string;
  setStatementMonth: Dispatch<SetStateAction<string>>;
  statementRows: LogisticsStatementRow[];
  statementLoading: boolean;
  loadStatement: (month?: string) => void;
  exportStatementCsv: () => void;
}) {
  return (
    <div className={styles.statementPanel}>
      <div className={styles.statementHeader}>
        <div>
          <strong>月结汇总</strong>
          <span>按审核通过日期统计供应商应付、开票和付款状态。</span>
        </div>
        <div className={styles.statementActions}>
          <input
            value={statementMonth}
            onChange={(event) => setStatementMonth(event.target.value)}
            type="month"
          />
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={statementLoading}
            onClick={() => loadStatement(statementMonth)}
          >
            {statementLoading ? "汇总中..." : "查询月结"}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!statementRows.length}
            onClick={exportStatementCsv}
          >
            导出对账单
          </button>
        </div>
      </div>
      <MonthlySummaryComponent rows={statementRows} />
      <SupplierSectionComponent rows={statementRows} loading={statementLoading} />
    </div>
  );
}
