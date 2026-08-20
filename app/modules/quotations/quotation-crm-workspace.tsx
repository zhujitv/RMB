import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import shell from "../../WorkspaceShell.module.css";
import { QuotationCustomerDetail } from "./quotation-customer-detail";
import {
  CUSTOMER_FILTER_OPTIONS,
  buildCrmSummary,
  buildCustomerInsights,
  filterCustomerInsights,
  latestQuotationTime,
  type CustomerFilterKey,
  type CustomerInsight,
  type CustomerMasterSeed,
} from "./quotation-crm-insights";
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
  canReadCustomers: boolean;
  canReadOrders: boolean;
  canReadPayments: boolean;
  canRegisterPayments: boolean;
  canConfirmPayments: boolean;
  onToggleCreate: () => void;
  onOpenOrders: (keyword: string) => void;
  onOpenPayments: (keyword: string) => void;
  onRefresh: () => void;
  onViewDetail: (quotation: QuotationRow) => void;
};

const CUSTOMER_PAGE_SIZE = 5;
type CustomersResponse = { customers?: CustomerMasterSeed[] };

function CustomerCard({ customer, onOpenCustomer }: { customer: CustomerInsight; onOpenCustomer: (customer: CustomerInsight) => void }) {
  const latest = customer.latestQuotation;
  const latestVersion = currentQuotationVersion(latest);
  const latestExpired = latest ? quotationValidityState(latest).expired : false;
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
        {latest
          ? <>最近 {quotationNumber(latest) || "未编号"} · {quotationStatusLabel(latest.status)}{latestExpired ? " · 已过期" : ""} · {formatCurrencyAmount(latestVersion?.currency || "CNY", quotationTotal(latest))}</>
          : "暂无报价 · 可先维护联系人和客户产品库"}
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
  canReadCustomers,
  canReadOrders,
  canReadPayments,
  canRegisterPayments,
  canConfirmPayments,
  onToggleCreate,
  onOpenOrders,
  onOpenPayments,
  onRefresh,
  onViewDetail,
}: QuotationCrmWorkspaceProps) {
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [customerMasters, setCustomerMasters] = useState<CustomerMasterSeed[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [customerReloadToken, setCustomerReloadToken] = useState(0);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerKeyword, setCustomerKeyword] = useState("");
  const [customerFilter, setCustomerFilter] = useState<CustomerFilterKey>("all");
  useEffect(() => {
    if (!canReadCustomers) return;
    let cancelled = false;
    setCustomersLoading(true); setCustomersError("");
    apiJson<CustomersResponse>("/api/customers")
      .then((result) => { if (!cancelled) setCustomerMasters(Array.isArray(result.customers) ? result.customers : []); })
      .catch((error) => { if (!cancelled) setCustomersError(error instanceof Error ? error.message : "读取客户档案失败"); })
      .finally(() => { if (!cancelled) setCustomersLoading(false); });
    return () => { cancelled = true; };
  }, [canReadCustomers, customerReloadToken]);
  const customerInsights = buildCustomerInsights(quotations, customerMasters);
  const filteredCustomers = filterCustomerInsights(customerInsights, customerKeyword, customerFilter);
  const selectedCustomer = customerInsights.find((customer) => customer.key === selectedCustomerKey);
  const crmSummary = buildCrmSummary(quotations, customerInsights);
  const recentQuotations = [...quotations].sort((left, right) => latestQuotationTime(right) - latestQuotationTime(left)).slice(0, 4);
  const customerTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / CUSTOMER_PAGE_SIZE));
  const safeCustomerPage = Math.min(customerPage, customerTotalPages);
  const visibleCustomers = filteredCustomers.slice((safeCustomerPage - 1) * CUSTOMER_PAGE_SIZE, safeCustomerPage * CUSTOMER_PAGE_SIZE);
  useEffect(() => {
    setCustomerPage(1);
  }, [customerKeyword, customerFilter]);
  useEffect(() => {
    if (customerPage > customerTotalPages) setCustomerPage(customerTotalPages);
  }, [customerPage, customerTotalPages]);

  if (selectedCustomer) {
    return (
      <QuotationCustomerDetail
        customer={selectedCustomer}
        canWriteQuotations={canWriteQuotations}
        canReadOrders={canReadOrders}
        canReadPayments={canReadPayments}
        canRegisterPayments={canRegisterPayments}
        canConfirmPayments={canConfirmPayments}
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
          <button className={shell.secondaryButton} type="button" disabled={loading || customersLoading} onClick={() => { setCustomerReloadToken((value) => value + 1); onRefresh(); }}>{loading || customersLoading ? "同步中..." : "同步客户动态"}</button>
        </div>
      </div>

      <div className={styles.crmStats}>
        <article><span>客户数</span><strong>{customerInsights.length}</strong><small>{canReadCustomers ? "来自客户档案" : "来自当前报价客户"}</small></article>
        <article><span>客户产品</span><strong>{crmSummary.productCount}</strong><small>按报价产品沉淀</small></article>
        <article><span>待跟进</span><strong>{crmSummary.followUpCount}</strong><small>已发送或已过期</small></article>
        <article><span>已成交</span><strong>{crmSummary.acceptedCount}</strong><small>客户已接受报价</small></article>
      </div>

      <div className={styles.crmGrid}>
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>客户档案</span><h3>业务员客户</h3></div><small>自动带出权限范围内客户 · 共 {customerInsights.length} 位 · 当前筛选 {filteredCustomers.length} 位</small></div>
          <div className={styles.customerFilters}>
            <input
              value={customerKeyword}
              placeholder="搜索客户 / 联系人 / 电话 / 邮箱 / 报价号 / 产品"
              onChange={(event) => setCustomerKeyword(event.target.value)}
            />
            <select value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value as CustomerFilterKey)}>
              {CUSTOMER_FILTER_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </div>
          {customersError ? <div className={styles.crmEmpty}>客户档案读取失败：{customersError}。当前仅显示报价中出现过的客户。</div> : null}
          <div className={styles.customerCards}>
            {visibleCustomers.length
              ? visibleCustomers.map((customer) => <CustomerCard customer={customer} key={customer.key} onOpenCustomer={(nextCustomer) => setSelectedCustomerKey(nextCustomer.key)} />)
              : <div className={styles.crmEmpty}>{customerKeyword || customerFilter !== "all" ? "当前搜索或筛选条件下没有客户。" : "当前权限范围内还没有客户档案或报价记录。"}</div>}
          </div>
          {filteredCustomers.length > CUSTOMER_PAGE_SIZE ? (
            <div className={shell.paginationBar}>
              <span>共 {filteredCustomers.length} 位客户，当前第 {safeCustomerPage} / {customerTotalPages} 页</span>
              <div>
                <button className={shell.secondaryButton} type="button" disabled={safeCustomerPage <= 1} onClick={() => setCustomerPage((value) => Math.max(1, value - 1))}>上一页</button>
                <button className={shell.secondaryButton} type="button" disabled={safeCustomerPage >= customerTotalPages} onClick={() => setCustomerPage((value) => Math.min(customerTotalPages, value + 1))}>下一页</button>
              </div>
            </div>
          ) : null}
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
