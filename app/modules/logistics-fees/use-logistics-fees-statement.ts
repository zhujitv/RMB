import { useState, type Dispatch, type SetStateAction } from "react";
import { apiJson } from "../../api";
import { downloadBlob } from "../../utils";
import type { LogisticsStatementRow } from "./model";
import {
  csvCell,
  logisticsCurrencySummaryPlainText,
  statementRowSummary,
} from "./shared";

type UseLogisticsFeesStatementParams = {
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useLogisticsFeesStatement({
  setError,
  setNotice,
}: UseLogisticsFeesStatementParams) {
  const [statementMonth, setStatementMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [statementRows, setStatementRows] = useState<LogisticsStatementRow[]>(
    [],
  );
  const [statementLoading, setStatementLoading] = useState(false);

  async function loadStatement(month = statementMonth) {
    setStatementLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams();
      if (month) params.set("month", month);
      const result = await apiJson<{ rows: LogisticsStatementRow[] }>(
        `/api/logistics-costs/statement${params.size ? `?${params}` : ""}`,
      );
      setStatementRows(Array.isArray(result.rows) ? result.rows : []);
    } catch (statementError) {
      setError(
        statementError instanceof Error
          ? statementError.message
          : "读取月结汇总失败",
      );
    } finally {
      setStatementLoading(false);
    }
  }

  function exportStatementCsv() {
    const header = [
      "月结月份",
      "供应商",
      "订单数",
      "应付金额",
      "待付款金额",
      "已付款金额",
    ];
    const body = statementRows.map((row) => [
      statementMonth,
      row.supplierName || "-",
      String(row.orderCount || 0),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "approved")),
      logisticsCurrencySummaryPlainText(
        statementRowSummary(row, "pendingPayment"),
      ),
      logisticsCurrencySummaryPlainText(statementRowSummary(row, "paid")),
    ]);
    const csv = [header, ...body]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `物流费用月结_${statementMonth || "全部"}.csv`);
    setNotice("物流费用月结对账单已开始导出");
  }

  return {
    statementMonth,
    setStatementMonth,
    statementRows,
    statementLoading,
    loadStatement,
    exportStatementCsv,
  };
}
