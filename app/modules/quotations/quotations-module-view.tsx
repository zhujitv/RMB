import { ConfirmationDialog, type ConfirmationDialogState } from "../../components";
import shell from "../../WorkspaceShell.module.css";
import { QuotationCrmWorkspace, QuotationRecordHeader } from "./quotation-crm-workspace";
import { QuotationDetailDrawer } from "./quotation-detail-drawer";
import { QuotationFormContainer } from "./quotation-form-container";
import { QuotationList } from "./quotation-list";
import styles from "./quotations.module.css";
import { hasCurrentManualQuotationAcceptance, type QuotationRow } from "./types";

type QuotationsModuleViewProps = {
  quotations: QuotationRow[];
  keyword: string;
  status: string;
  page: number;
  total: number;
  totalPages: number;
  loading: boolean;
  error: string;
  notice: string;
  createOpen: boolean;
  editQuotation: QuotationRow | null;
  detailQuotation: QuotationRow | null;
  detailLoading: boolean;
  detailLoaded: boolean;
  detailError: string;
  voiding: boolean;
  deleting: boolean;
  canWriteQuotations: boolean;
  canDeleteQuotationDrafts: boolean;
  canSendCustomerEmail: boolean;
  canWriteSalesExecution: boolean;
  canReadCustomers: boolean;
  canReadOrders: boolean;
  canReadPayments: boolean;
  canRegisterPayments: boolean;
  canConfirmPayments: boolean;
  confirmation: ConfirmationDialogState | null;
  onSetKeyword: (value: string) => void;
  onSetStatus: (value: string) => void;
  onSubmitSearch: () => void;
  onResetSearch: () => void;
  onToggleCreate: () => void;
  onOpenOrders: (keyword: string) => void;
  onOpenPayments: (keyword: string) => void;
  onRefresh: () => void;
  onCancelForm: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
  onPage: (page: number) => void;
  onViewDetail: (quotation: QuotationRow) => void;
  onEdit: (quotation: QuotationRow) => void;
  onVoid: (quotation: QuotationRow) => void;
  onDelete: (quotation: QuotationRow) => void;
  onOpenSalesExecution: (quotationId: string, quotationNo: string, executionId?: string, customerOrderNo?: string) => void;
  onCloseDetail: () => void;
  onCancelConfirmation: () => void;
  onConfirmConfirmation: () => void;
  onUpdateConfirmationInput: (value: string) => void;
};

export function QuotationsModuleView({
  quotations,
  keyword,
  status,
  page,
  total,
  totalPages,
  loading,
  error,
  notice,
  createOpen,
  editQuotation,
  detailQuotation,
  detailLoading,
  detailLoaded,
  detailError,
  voiding,
  deleting,
  canWriteQuotations,
  canDeleteQuotationDrafts,
  canSendCustomerEmail,
  canWriteSalesExecution,
  canReadCustomers,
  canReadOrders,
  canReadPayments,
  canRegisterPayments,
  canConfirmPayments,
  confirmation,
  ...actions
}: QuotationsModuleViewProps) {
  return (
    <section className={shell.moduleCard}>
      <div className={shell.moduleHeader}>
        <div>
          <h2>客户与报价</h2>
          <p className={styles.moduleIntro}>客户产品、历史价格、报价发送和客户确认统一在这里处理。</p>
        </div>
        <div className={shell.headerActions}>
          {canWriteQuotations ? (
            <button className={shell.primaryButtonCompact} type="button" onClick={actions.onToggleCreate}>
              {createOpen ? "收起新建" : "新建报价"}
            </button>
          ) : null}
          <button className={shell.secondaryButton} type="button" disabled={loading} onClick={actions.onRefresh}>
            {loading ? "刷新中..." : "刷新"}
          </button>
        </div>
      </div>

      {canWriteQuotations && (createOpen || editQuotation) ? (
        <QuotationFormContainer initialQuotation={editQuotation} onCancel={actions.onCancelForm} onSaved={actions.onSaved} />
      ) : null}

      <QuotationCrmWorkspace
        quotations={quotations}
        loading={loading}
        createOpen={createOpen}
        canWriteQuotations={canWriteQuotations}
        canReadCustomers={canReadCustomers}
        canReadOrders={canReadOrders}
        canReadPayments={canReadPayments}
        canRegisterPayments={canRegisterPayments}
        canConfirmPayments={canConfirmPayments}
        onToggleCreate={actions.onToggleCreate}
        onOpenOrders={actions.onOpenOrders}
        onOpenPayments={actions.onOpenPayments}
        onRefresh={actions.onRefresh}
        onViewDetail={actions.onViewDetail}
      />

      <div className={shell.listToolbar}>
        <input
          value={keyword}
          placeholder="搜索客户 / 联系人 / 报价号 / 发票号 / 业务员"
          onChange={(event) => actions.onSetKeyword(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") actions.onSubmitSearch(); }}
        />
        <select value={status} disabled={loading} onChange={(event) => actions.onSetStatus(event.target.value)}>
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="SENT">已发送</option>
          <option value="ACCEPTED">客户已接受</option>
          <option value="REJECTED">客户已拒绝</option>
          <option value="VOIDED">已作废</option>
        </select>
        <button className={shell.primaryButtonCompact} type="button" disabled={loading} onClick={actions.onSubmitSearch}>查询</button>
        <button className={shell.secondaryButton} type="button" disabled={loading} onClick={actions.onResetSearch}>重置</button>
      </div>

      {error ? <div className={shell.inlineError} role="alert">{error}</div> : null}
      {notice ? <div className={shell.infoStrip} role="status">{notice}</div> : null}
      <QuotationRecordHeader total={total} />
      <QuotationList
        quotations={quotations}
        loading={loading}
        page={page}
        total={total}
        totalPages={totalPages}
        onPage={actions.onPage}
        onViewDetail={actions.onViewDetail}
      />

      {detailQuotation ? (
        <QuotationDetailDrawer
          quotation={detailQuotation}
          loading={detailLoading}
          error={detailError}
          canWrite={canWriteQuotations}
          canSendCustomerEmail={canSendCustomerEmail}
          canEdit={detailLoaded && !detailLoading && !detailError && canWriteQuotations && ["DRAFT", "SENT", "REJECTED"].includes(String(detailQuotation.status))}
          canVoid={detailLoaded && !detailLoading && !detailError && canWriteQuotations && ["DRAFT", "SENT", "REJECTED"].includes(String(detailQuotation.status))}
          canDelete={detailLoaded && !detailLoading && !detailError && canDeleteQuotationDrafts
            && detailQuotation.status === "DRAFT" && (detailQuotation.deliveries || []).length === 0}
          canConvert={detailLoaded && !detailLoading && !detailError && canWriteSalesExecution
            && (Boolean(detailQuotation.salesExecution?.id) || hasCurrentManualQuotationAcceptance(detailQuotation))}
          voiding={voiding}
          deleting={deleting}
          onEdit={() => actions.onEdit(detailQuotation)}
          onVoid={() => actions.onVoid(detailQuotation)}
          onDelete={() => actions.onDelete(detailQuotation)}
          onOpenSalesExecution={() => actions.onOpenSalesExecution(detailQuotation.id, detailQuotation.quoteNo || detailQuotation.invoiceNo || "", detailQuotation.salesExecution?.id || "", detailQuotation.salesExecution?.customerOrderNo || "")}
          onSaved={actions.onSaved}
          onClose={actions.onCloseDetail}
        />
      ) : null}
      {confirmation ? (
        <ConfirmationDialog
          state={confirmation}
          onCancel={actions.onCancelConfirmation}
          onConfirm={actions.onConfirmConfirmation}
          onInputChange={actions.onUpdateConfirmationInput}
        />
      ) : null}
    </section>
  );
}
