"use client";

import type { ReactNode } from "react";
import type { CurrencyTotals } from "../../lib/platform/currency-totals";
import { formatCurrencyAmount, formatCny } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { ExportInvoiceRemark } from "./types";
import { mergeClassNames } from "./ui-primitives";

function normalizeExportInvoiceRemark(value?: ExportInvoiceRemark | null) {
  return Array.isArray(value?.containers)
    ? value.containers.filter((item) => item && Object.values(item).some(Boolean))
    : [];
}

export function ExportInvoiceRemarkView({
  remark,
  fallbackText = "",
  emptyText = "暂无出口发票备注，请前往物流信息维护。",
}: {
  remark?: ExportInvoiceRemark | null;
  fallbackText?: string;
  emptyText?: string;
}) {
  const containers = normalizeExportInvoiceRemark(remark);
  if (!containers.length) {
    return (
      <div className={styles.exportInvoiceRemarkText}>
        {fallbackText || emptyText}
      </div>
    );
  }
  return (
    <div className={styles.exportInvoiceRemarkBlocks}>
      {containers.map((item, index) => (
        <div className={styles.exportInvoiceRemarkBlock} key={`${item.containerNo || item.truckNo || "container"}-${index}`}>
          <strong>Container: {item.containerNo || "-"}</strong>
          <div className={styles.exportInvoiceRemarkBlockGrid}>
            <span>柜型：{item.type || "-"}</span>
            <span>车牌：{item.truckNo || "-"}</span>
            <span>挂车：{item.trailerNo || "-"}</span>
            <span>起运：{item.shipDate || "-"}</span>
            <span>路线：{item.origin || "-"} → {item.destination || "-"}</span>
            <span>货物：{item.goods || "-"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MoneyAmount({
  currency = "CNY",
  amount,
  amountCny,
  prefix = "",
  className,
}: {
  currency?: string;
  amount?: unknown;
  amountCny?: unknown;
  prefix?: string;
  className?: string;
}) {
  const normalizedCurrency = String(currency || "CNY").toUpperCase();
  const hasAmount = amount !== "" && amount != null;
  const primaryAmount = Number(hasAmount ? amount : amountCny || 0);
  const cnyAmount = Number(amountCny ?? amount ?? 0);
  const showForeignAmount = normalizedCurrency !== "CNY" && hasAmount && Number.isFinite(primaryAmount);

  if (!showForeignAmount) {
    return (
      <div className={mergeClassNames(styles.amountCell, styles.amountCellSingle, className)}>
        <div className={styles.currencyAmount}>{prefix}CNY：{formatCurrencyAmount("CNY", cnyAmount)}</div>
      </div>
    );
  }

  return (
    <div className={mergeClassNames(styles.amountCell, className)}>
      <div className={styles.currencyAmount}>{prefix}{normalizedCurrency}：{formatCurrencyAmount(normalizedCurrency, primaryAmount)}</div>
      <div className={styles.cnyAmount}>≈ {formatCny(cnyAmount)}</div>
    </div>
  );
}

export function CurrencyTotalsDisplay({
  summary,
  cnyLabel = "人民币实际金额",
  foreignLabel,
  totalLabel = "折人民币总额",
  className,
}: {
  summary?: CurrencyTotals | null;
  cnyLabel?: string;
  foreignLabel?: (currency: string) => string;
  totalLabel?: string;
  className?: string;
}) {
  const totals = summary || { cnyActual: 0, foreignTotals: [], totalCny: 0 };
  const foreignTotals = Array.isArray(totals.foreignTotals) ? totals.foreignTotals : [];
  const showCny = Number(totals.cnyActual || 0) !== 0 || foreignTotals.length === 0;
  return (
    <span className={mergeClassNames(styles.currencyTotalsList, className)}>
      {showCny ? (
        <span className={styles.currencyTotalsRow}>
          <span>{cnyLabel}</span>
          <strong>{formatCurrencyAmount("CNY", totals.cnyActual)}</strong>
        </span>
      ) : null}
      {foreignTotals.map((item) => (
        <span key={item.currency} className={styles.currencyTotalsRow}>
          <span>{foreignLabel ? foreignLabel(item.currency) : `${item.currency} 实际金额`}</span>
          <strong>{formatCurrencyAmount(item.currency, item.amount)}</strong>
        </span>
      ))}
      <span className={styles.currencyTotalsRow}>
        <span>{totalLabel}</span>
        <strong>{formatCny(Number(totals.totalCny || 0))}</strong>
      </span>
    </span>
  );
}

export function DetailField({
  label,
  value,
  wide = false,
  hidden = false,
}: {
  label: ReactNode;
  value: ReactNode;
  wide?: boolean;
  hidden?: boolean;
}) {
  if (hidden || value == null || value === "" || value === "-") return null;
  return (
    <div className={`${styles.detailField} ${wide ? styles.detailFieldWide : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PaginationBar({
  total,
  page,
  totalPages,
  loading = false,
  onPage,
}: {
  total: number;
  page: number;
  totalPages: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.paginationBar}>
      <span>共 {total} 条，当前第 {page} / {totalPages} 页</span>
      <div>
        <button className={styles.secondaryButton} type="button" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>上一页</button>
        <button className={styles.secondaryButton} type="button" disabled={page >= totalPages || loading} onClick={() => onPage(Math.min(totalPages, page + 1))}>下一页</button>
      </div>
    </div>
  );
}
