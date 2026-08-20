import { useState } from "react";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { QuotationCustomerDetail } from "./quotation-customer-detail";
import { buildCrmSummary, buildCustomerInsights, latestQuotationTime, type CustomerInsight } from "./quotation-crm-insights";
import { quotationValidityState } from "./quotation-expiry";
import styles from "./quotation-crm-workspace.module.css";
import {
  currentQuotationVersion,
  quotationCustomerName,
  quotationNumber,
  quotationStatusLabel,
  quotationTotal,
  type QuotationRow,
} from "./types";

type QuotationCrmWorkspaceProps = {
  quotations: QuotationRow[];
  loading: boolean;
  createOpen: boolean;
  canWriteQuotations: boolean;
  canReadOrders: boolean;
  canReadPayments: boolean;
  onToggleCreate: () => void;
  onOpenOrders: (keyword: string) => void;
  onOpenPayments: (keyword: string) => void;
  onRefresh: () => void;
  onViewDetail: (quotation: QuotationRow) => void;
};

const MAX_VISIBLE_CUSTOMERS = 4;

function CustomerCard({ customer, onOpenCustomer }: { customer: CustomerInsight; onOpenCustomer: (customer: CustomerInsight) => void }) {
  const latest = customer.latestQuotation;
  const latestVersion = currentQuotationVersion(latest);
  const latestExpired = quotationValidityState(latest).expired;
  return (
    <button className={styles.customerCard} type="button" onClick={() => onOpenCustomer(customer)}>
      <span className={styles.customerCardTop}>
        <span><strong>{customer.name}</strong><small>{customer.legalName || "未维护客户全称"}</small></span>
        <span className={styles.crmBadge}>{customer.pendingCount ? `${customer.pendingCount} 待跟进` : "暂无待办"}</span>
      </span>
      <span className={styles.customerMeta}>
        <span>联系人：{customer.contactPerson}</span><span>电话：{customer.contactPhone}</span><span>邮箱：{customer.contactEmail}</span>
      </span>
      <span className={styles.customerMetrics}>
        <span>报价 <strong>{customer.quoteCount}</strong></span><span>成交 <strong>{customer.acceptedCount}</strong></span><span>产品 <strong>{customer.productNames.size}</strong></span>
      </span>
      <span className={styles.customerLatest}>
        最近 {quotationNumber(latest) || "未编号"} · {quotationStatusLabel(latest.status)}
        {latestExpired ? " · 已过期" : ""} · {formatCurrencyAmount(latestVersion?.currency || "CNY", quotationTotal(latest))}
      </span>
      <span className={styles.openCustomerHint}>进入客户详情 / 客户产品库</span>
    </button>
  );
}

export function QuotationRecordHeader({ total }: { total: number }) {
  return (
    <div className={styles.recordHeader}>
      <div><span className={styles.crmEyebrow}>报价记录</span><h3>历史报价明细</h3></div>
      <small>当前筛选共 {total} 条</small>
    </div>
  );
}

export function QuotationCrmWorkspace({
  quotations,
  loading,
  createOpen,
  canWriteQuotations,
  canReadOrders,
  canReadPayments,
  onToggleCreate,
  onOpenOrders,
  onOpenPayments,
  onRefresh,
  onViewDetail,
}: QuotationCrmWorkspaceProps) {
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const customerInsights = buildCustomerInsights(quotations);
  const selectedCustomer = customerInsights.find((customer) => customer.key === selectedCustomerKey);
  const crmSummary = buildCrmSummary(quotations, customerInsights);
  const recentQuotations = [...quotations].sort((left, right) => latestQuotationTime(right) - latestQuotationTime(left)).slice(0, 4);

  if (selectedCustomer) {
    return (
      <QuotationCustomerDetail
        customer={selectedCustomer}
        canWriteQuotations={canWriteQuotations}
        canReadOrders={canReadOrders}
        canReadPayments={canReadPayments}
        createOpen={createOpen}
        onBack={() => setSelectedCustomerKey("")}
        onToggleCreate={onToggleCreate}
        onOpenOrders={onOpenOrders}
        onOpenPayments={onOpenPayments}
        onViewQuotation={onViewDetail}
      />
    );
  }

  return (
    <section className={styles.crmWorkspace} aria-label="客户与报价 CRM 工作台">
      <div className={styles.crmHero}>
        <div><span className={styles.crmEyebrow}>CRM 工作台</span><h3>先看客户，再处理报价</h3></div>
        <div className={styles.crmHeroActions}>
          {canWriteQuotations ? <button className={shell.primaryButtonCompact} type="button" onClick={onToggleCreate}>{createOpen ? "继续编辑报价" : "为客户新建报价"}</button> : null}
          <button className={shell.secondaryButton} type="button" disabled={loading} onClick={onRefresh}>{loading ? "同步中..." : "同步客户动态"}</button>
        </div>
      </div>

      <div className={styles.crmStats}>
        <article><span>客户数</span><strong>{customerInsights.length}</strong><small>来自当前报价客户</small></article>
        <article><span>客户产品</span><strong>{crmSummary.productCount}</strong><small>按报价产品沉淀</small></article>
        <article><span>待跟进</span><strong>{crmSummary.followUpCount}</strong><small>已发送或已过期</small></article>
        <article><span>已成交</span><strong>{crmSummary.acceptedCount}</strong><small>客户已接受报价</small></article>
      </div>

      <div className={styles.crmGrid}>
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>客户档案</span><h3>重点客户</h3></div><small>按最近报价排序</small></div>
          <div className={styles.customerCards}>
            {customerInsights.slice(0, MAX_VISIBLE_CUSTOMERS).length
              ? customerInsights.slice(0, MAX_VISIBLE_CUSTOMERS).map((customer) => <CustomerCard customer={customer} key={customer.key} onOpenCustomer={(nextCustomer) => setSelectedCustomerKey(nextCustomer.key)} />)
              : <div className={styles.crmEmpty}>当前条件下还没有客户报价。新建报价后，这里会自动形成客户卡片。</div>}
          </div>
        </section>
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>销售动作</span><h3>跟进提醒</h3></div><small>报价、订单和应收联动</small></div>
          <div className={styles.followUpCards}>
            <article><strong>{crmSummary.sentCount}</strong><span>待客户确认</span><small>已发送报价，等待客户接受或拒绝。</small></article>
            <article><strong>{crmSummary.expiredCount}</strong><span>已过期需重报</span><small>报价有效期已过，适合重新生成版本。</small></article>
            <article><strong>{crmSummary.draftCount}</strong><span>草稿待完善</span><small>可继续补齐客户、产品和报价条款。</small></article>
            <article><strong>{crmSummary.rejectedCount}</strong><span>拒绝后复盘</span><small>记录客户反馈，保留历史价格依据。</small></article>
          </div>
        </section>
      </div>

      <div className={styles.crmGrid}>
        <section className={`${styles.crmPanel} ${styles.fullWidthPanel}`}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>最近动态</span><h3>报价时间线</h3></div><small>点击可查看详情</small></div>
          <div className={styles.timelineList}>
            {recentQuotations.length ? recentQuotations.map((quotation) => {
              const version = currentQuotationVersion(quotation);
              return (
                <button className={styles.timelineItem} type="button" key={quotation.id} onClick={() => onViewDetail(quotation)}>
                  <span><strong>{quotationNumber(quotation) || "未编号"}</strong><small>{quotationCustomerName(quotation)}</small></span>
                  <span><strong>{quotationStatusLabel(quotation.status)}</strong><small>{formatDate(quotation.updatedAt || quotation.createdAt || version?.createdAt)}</small></span>
                </button>
              );
            }) : <div className={styles.crmEmpty}>暂无报价动态。</div>}
          </div>
        </section>
      </div>
    </section>
  );
}
