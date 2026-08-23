import { useState } from "react";
import { formatCurrencyAmount, formatDate } from "../../formatters";
import { CustomerProductsManager } from "../settings/customer-products-manager";
import shell from "../../WorkspaceShell.module.css";
import { useWorkspaceTabDiscardGuard } from "../../workspace/workspace-tab-context";
import { QuotationCustomerBusinessRecords } from "./quotation-customer-business-records";
import { QuotationCustomerContacts, type CustomerContactFields } from "./quotation-customer-contacts";
import { QuotationCustomerEmails } from "./quotation-customer-emails";
import { QuotationCustomerFollowUps } from "./quotation-customer-follow-ups";
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
  canReadOrders: boolean;
  canReadPayments: boolean;
  canRegisterPayments: boolean;
  canConfirmPayments: boolean;
  createOpen: boolean;
  onBack: () => void;
  onToggleCreate: () => void;
  onOpenOrders: (keyword: string) => void;
  onOpenPayments: (keyword: string) => void;
  onViewQuotation: (quotation: QuotationRow) => void;
  onCustomerContactSaved: (contact: CustomerContactFields) => void;
};


export function QuotationCustomerDetail({
  customer,
  canWriteQuotations,
  canReadOrders,
  canReadPayments,
  canRegisterPayments,
  canConfirmPayments,
  createOpen,
  onBack,
  onToggleCreate,
  onOpenOrders,
  onOpenPayments,
  onViewQuotation,
  onCustomerContactSaved,
}: QuotationCustomerDetailProps) {
  const [productsOpen, setProductsOpen] = useState(false);
  const latest = customer.latestQuotation;
  const latestVersion = currentQuotationVersion(latest);
  const confirmDiscard = useWorkspaceTabDiscardGuard("联系人或客户资料有未保存修改，确定离开当前页面吗？");
  const productCustomer = customer.customerId ? {
    id: customer.customerId,
    shortName: customer.name,
    name: customer.legalName || customer.name,
    fullName: customer.legalName || customer.name,
  } : null;

  return (
    <section className={styles.customerDetail} aria-label="客户 CRM 详情">
      <div className={styles.detailHero}>
        <button className={shell.secondaryButton} type="button" onClick={() => { if (confirmDiscard()) onBack(); }}>返回客户工作台</button>
        <div><span className={styles.crmEyebrow}>客户 CRM</span><h3>{customer.name}</h3><p>{customer.legalName || "未维护客户全称"}</p></div>
        <div className={styles.detailHeroActions}>
          {productCustomer ? <button className={shell.secondaryButton} type="button" onClick={() => setProductsOpen(true)}>管理产品库</button> : null}
          {canWriteQuotations ? <button className={shell.primaryButtonCompact} type="button" onClick={onToggleCreate}>{createOpen ? "继续编辑报价" : "新建报价"}</button> : null}
        </div>
      </div>

      <div className={styles.detailMetrics}>
        <article><span>报价总数</span><strong>{customer.quoteCount}</strong></article>
        <article><span>成交报价</span><strong>{customer.acceptedCount}</strong></article>
        <article><span>待跟进</span><strong>{customer.pendingCount}</strong></article>
        <article><span>报价产品</span><strong>{customer.productNames.size}</strong></article>
      </div>

      <div className={styles.detailGrid}>
        <QuotationCustomerContacts customer={customer} canWriteQuotations={canWriteQuotations} onSaved={onCustomerContactSaved} />
        <section className={styles.crmPanel}>
          <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>最近报价</span><h3>最新一次报价动态</h3></div><small>{latest ? quotationNumber(latest) || "未编号" : "暂无报价"}</small></div>
          <div className={styles.profileGrid}>
            <span>最近报价<strong>{latest ? quotationNumber(latest) || "未编号" : "暂无报价"}</strong></span>
            <span>最近金额<strong>{latest ? formatCurrencyAmount(latestVersion?.currency || "CNY", quotationTotal(latest)) : "-"}</strong></span>
            <span>最近更新<strong>{latest ? formatDate(latest.updatedAt || latest.createdAt || latestVersion?.createdAt) : "-"}</strong></span>
          </div>
        </section>
        <QuotationCustomerBusinessRecords
          customer={customer}
          canReadOrders={canReadOrders}
          canReadPayments={canReadPayments}
          canRegisterPayments={canRegisterPayments}
          canConfirmPayments={canConfirmPayments}
          onOpenOrders={onOpenOrders}
          onOpenPayments={onOpenPayments}
        />
      </div>

      <QuotationCustomerFollowUps customer={customer} canWriteQuotations={canWriteQuotations} />
      <QuotationCustomerEmails customer={customer} canWriteQuotations={canWriteQuotations} />

      <section className={styles.crmPanel}>
        <div className={styles.crmPanelHeader}><div><span className={styles.crmEyebrow}>历史报价</span><h3>该客户报价记录</h3></div><small>点击查看报价详情</small></div>
        <div className={styles.quoteCards}>
          {customer.quotations.length ? customer.quotations.map((quotation) => {
            const version = currentQuotationVersion(quotation);
            return (
              <button className={styles.quoteCard} type="button" key={quotation.id} onClick={() => onViewQuotation(quotation)}>
                <span><strong>{quotationNumber(quotation) || "未编号"}</strong><small>{quotationStatusLabel(quotation.status)}</small></span>
                <span><strong>{formatCurrencyAmount(version?.currency || "CNY", quotationTotal(quotation))}</strong><small>有效期至 {formatDate(version?.validUntil)}</small></span>
                <span><strong>V{quotation.currentVersionNumber || version?.versionNumber || 1}</strong><small>预计交期 {version?.leadTimeDays == null || version.leadTimeDays === "" ? "-" : `${version.leadTimeDays} 天`}</small></span>
              </button>
            );
          }) : <div className={styles.crmEmpty}>该客户暂无历史报价，可以先维护联系人，再新建报价；产品库可从页面顶部进入。</div>}
        </div>
      </section>

      {productsOpen && productCustomer ? (
        <CustomerProductsManager
          customer={productCustomer}
          canWrite={canWriteQuotations}
          onClose={() => setProductsOpen(false)}
        />
      ) : null}
    </section>
  );
}
