import { PaginationBar } from "../../components";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { quotationValidityState } from "./quotation-expiry";
import responsive from "./quotation-responsive.module.css";
import styles from "./quotations.module.css";
import {
  currentQuotationVersion,
  quotationCustomerLegalName,
  quotationCustomerName,
  quotationNumber,
  quotationStatusLabel,
  quotationTotal,
  type QuotationRow,
} from "./types";

function statusClass(quotation: QuotationRow, expired: boolean) {
  if (expired) return shell.statusWarning;
  if (quotation.status === "ACCEPTED") return shell.statusSuccess;
  if (quotation.status === "REJECTED") return shell.statusDanger;
  if (quotation.status === "SENT") return shell.statusInfo;
  if (quotation.status === "VOIDED") return shell.statusMuted;
  return "";
}

function visibleStatus(quotation: QuotationRow, expired: boolean) {
  return expired ? `${quotationStatusLabel(quotation.status)} · 已过期` : quotationStatusLabel(quotation.status);
}

export function QuotationList({
  quotations,
  loading,
  page,
  total,
  totalPages,
  onPage,
  onViewDetail,
}: {
  quotations: QuotationRow[];
  loading: boolean;
  page: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onViewDetail: (quotation: QuotationRow) => void;
}) {
  return (
    <>
      <div className={`${shell.tableWrap} ${shell.tablePinnedTwoCols} ${responsive.desktopList}`}>
        <table className={shell.dataTable}>
          <thead>
            <tr>
              <th className={shell.orderNoColumn}>报价号</th>
              <th className={shell.customerColumn}>客户</th>
              <th>版本</th>
              <th>币种</th>
              <th className={shell.amountColumn}>报价金额</th>
              <th>有效期至</th>
              <th>预计交期</th>
              <th className={shell.statusColumn}>状态</th>
              <th className={shell.operationColumn}>详情</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className={shell.emptyState}>报价数据加载中...</div></td></tr>
            ) : quotations.length ? quotations.map((quotation) => {
              const version = currentQuotationVersion(quotation);
              const validity = quotationValidityState(quotation);
              return (
                <tr className={shell.clickableRow} key={quotation.id} onClick={() => onViewDetail(quotation)}>
                  <td className={shell.orderNoColumn}><strong>{quotationNumber(quotation) || "-"}</strong></td>
                  <td className={shell.customerColumn} title={quotationCustomerLegalName(quotation)}>
                    <span className={styles.listCustomer}>
                      <strong>{quotationCustomerName(quotation)}</strong>
                      <small>{quotationCustomerLegalName(quotation)}</small>
                    </span>
                  </td>
                  <td>V{quotation.currentVersionNumber || version?.versionNumber || 1}</td>
                  <td>{version?.currency || "-"}</td>
                  <td className={shell.amountColumn}>{formatCurrencyAmount(version?.currency || "CNY", quotationTotal(quotation))}</td>
                  <td>{formatDate(version?.validUntil)}</td>
                  <td>{version?.leadTimeDays == null || version.leadTimeDays === "" ? "-" : `${version.leadTimeDays} 天`}</td>
                  <td className={shell.statusColumn}>
                    <span className={`${shell.statusPill} ${statusClass(quotation, validity.expired)}`}>
                      {visibleStatus(quotation, validity.expired)}
                    </span>
                  </td>
                  <td className={shell.operationColumn}>
                    <button className={shell.rowDetailButton} type="button" onClick={(event) => { event.stopPropagation(); onViewDetail(quotation); }}>详情</button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={9}><div className={shell.emptyState}>未找到匹配的报价记录</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className={responsive.mobileList} aria-live="polite">
        {loading ? <div className={shell.emptyState}>报价数据加载中...</div> : quotations.length ? (
          quotations.map((quotation) => {
            const version = currentQuotationVersion(quotation);
            const validity = quotationValidityState(quotation);
            const customer = quotationCustomerName(quotation);
            return (
              <button
                className={responsive.mobileCard}
                type="button"
                key={quotation.id}
                aria-label={`查看报价 ${quotationNumber(quotation) || "未编号"}，客户 ${customer}，状态 ${visibleStatus(quotation, validity.expired)}`}
                onClick={() => onViewDetail(quotation)}
              >
                <span className={responsive.mobileCardHeader}>
                  <strong>{quotationNumber(quotation) || "未编号"}</strong>
                  <span
                    className={responsive.mobileStatus}
                    data-status={quotation.status || "DRAFT"}
                    data-expired={validity.expired ? "true" : "false"}
                  >
                    {visibleStatus(quotation, validity.expired)}
                  </span>
                </span>
                <span className={responsive.mobileCardCustomer}>
                  <span>{customer}</span>
                  <small>V{quotation.currentVersionNumber || version?.versionNumber || 1}</small>
                </span>
                <span className={responsive.mobileMetrics}>
                  <span>报价金额<strong>{formatCurrencyAmount(version?.currency || "CNY", quotationTotal(quotation))}</strong></span>
                  <span>有效期至<strong>{formatDate(version?.validUntil)}</strong></span>
                  <span>币种<strong>{version?.currency || "-"}</strong></span>
                  <span>预计交期<strong>{version?.leadTimeDays == null || version.leadTimeDays === "" ? "-" : `${version.leadTimeDays} 天`}</strong></span>
                </span>
              </button>
            );
          })
        ) : <div className={shell.emptyState}>未找到匹配的报价记录</div>}
      </div>
      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={onPage} />
    </>
  );
}
