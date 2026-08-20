import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { QuotationCustomerContacts } from "./quotation-customer-contacts";
import { QuotationCustomerFollowUps } from "./quotation-customer-follow-ups";
import { QuotationCustomerProductsEditor } from "./quotation-customer-products-editor";
import styles from "./quotation-crm-workspace.module.css";
import type { CustomerInsight } from "./quotation-crm-insights";
import {
  currentQuotationVersion,
  quotationNumber,
  quotationStatusLabel,
  quotationTotal,
  type QuotationRow,
} from "./types";

type QuotationCustomerDetailProps = {
  customer: CustomerInsight;
  canWriteQuotations: boolean;
  createOpen: boolean;
  onBack: () => void;
  onToggleCreate: () => void;
  onViewQuotation: (quotation: QuotationRow) => void;
};


export function QuotationCustomerDetail({
  customer,
  canWriteQuotations,
  createOpen,
  onBack,
  onToggleCreate,
  onViewQuotation,
}: QuotationCustomerDetailProps) {
  const latest = customer.latestQuotation;
  const latestVersion = currentQuotationVersion(latest);
  return (
    <section className={styles.customerDetail} aria-label="客户 CRM 详情">
      <div className={styles.detailHero}>
        <button className={shell.secondaryButton} type="button" onClick={onBack}>返回客户工作台</button>
        <div><span className={styles.crmEyebrow}>客户 CRM</span><h3>{customer.name}</h3><p>{customer.legalName || "未维护客户全称"}</p></div>
        {canWriteQuotations ? <button className={shell.primaryButtonCompact} type="button" onClick={onToggleCreate}>{createOpen ? "继续编辑报价" : "新建报价"}</button> : null}
      </div>

      <div className={styles.detailMetrics}>
        <article><span>报价总数</span><strong>{customer.quoteCount}</strong></article>
        <article><span>成交报价</span><strong>{customer.acceptedCount}</strong></article>
        <article><span>待跟进</span><strong>{customer.pendingCount}</strong></article>
        <article><span>报价产品</span><strong>{customer.productNames.size}</strong></article>
      </div>

      <div className={styles.detailGrid}>
        <QuotationCustomerContacts customer={customer} canWriteQuotations={canWriteQuotations} />
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>最近报价</span><h3>最新一次报价动态</h3></div><small>{quotationNumber(latest) || "未编号"}</small></div>
          <div className={styles.profileGrid}>
            <span>最近报价<strong>{quotationNumber(latest) || "未编号"}</strong></span>
            <span>最近金额<strong>{formatCurrencyAmount(latestVersion?.currency || "CNY", quotationTotal(latest))}</strong></span>
            <span>最近更新<strong>{formatDate(latest.updatedAt || latest.createdAt || latestVersion?.createdAt)}</strong></span>
          </div>
        </section>
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>客户产品库</span><h3>物料编码与产品属性</h3></div><small>来自客户产品接口</small></div>
          <QuotationCustomerProductsEditor customer={customer} canWriteQuotations={canWriteQuotations} />
        </section>
      </div>

      <QuotationCustomerFollowUps customer={customer} canWriteQuotations={canWriteQuotations} />

      <section className={styles.crmPanel}>
        <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>历史报价</span><h3>该客户报价记录</h3></div><small>点击查看报价详情</small></div>
        <div className={styles.quoteCards}>
          {customer.quotations.map((quotation) => {
            const version = currentQuotationVersion(quotation);
            return (
              <button className={styles.quoteCard} type="button" key={quotation.id} onClick={() => onViewQuotation(quotation)}>
                <span><strong>{quotationNumber(quotation) || "未编号"}</strong><small>{quotationStatusLabel(quotation.status)}</small></span>
                <span><strong>{formatCurrencyAmount(version?.currency || "CNY", quotationTotal(quotation))}</strong><small>有效期至 {formatDate(version?.validUntil)}</small></span>
                <span><strong>V{quotation.currentVersionNumber || version?.versionNumber || 1}</strong><small>预计交期 {version?.leadTimeDays == null || version.leadTimeDays === "" ? "-" : `${version.leadTimeDays} 天`}</small></span>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
