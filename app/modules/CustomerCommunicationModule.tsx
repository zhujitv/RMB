"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiRequestError, apiJson } from "../api";
import { DetailField, DismissibleLayer, PaginationBar } from "../components";
import { formatDate, formatDateTime } from "../formatters";
import { preventEnterFormSubmit } from "../formGuards";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";

type CommunicationRow = {
  id: string;
  orderNo?: string;
  customerShortName?: string;
  billOfLadingNo?: string;
  businessEntityName?: string;
  declarationDate?: string | null;
  logisticsStatus?: string;
  clearanceStatus?: string;
  clearanceStatusLabel?: string;
  latestSentAt?: string | null;
};

type AvailableFile = {
  key: string;
  label: string;
  requiredForClearance?: boolean;
  exists?: boolean;
  fileCount?: number;
  fileName?: string;
  uploadedBy?: string;
  uploadedAt?: string | null;
  previewUrl?: string;
  downloadUrl?: string;
};

type DraftDocument = {
  typeKey?: string;
  label?: string;
  emailLabel?: string;
  fileName?: string;
  fileCount?: number;
  exists?: boolean;
};

type CommunicationDraft = {
  orderNo?: string;
  blNo?: string;
  billOfLadingNo?: string;
  customsDeclarationDate?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  language?: string;
  subject?: string;
  body?: string;
  documents?: DraftDocument[];
  missingLabels?: string[];
  incompleteMessage?: string;
};

type CommunicationRecord = {
  id: string;
  sentAt?: string | null;
  createdAt?: string | null;
  sentByName?: string;
  recipientEmails?: string[];
  ccEmails?: string[];
  emailTypeLabel?: string;
  documentTypes?: string[];
  attachments?: Array<{ fileName?: string; originalFilename?: string; documentTypeLabel?: string }>;
  sendStatus?: string;
  sendStatusLabel?: string;
  errorMessage?: string;
};

type CommunicationDetail = {
  order: CommunicationRow;
  canSend?: boolean;
  customer?: {
    fullName?: string;
    shortName?: string;
    defaultToEmails?: string[];
    defaultCcEmails?: string[];
    languagePreference?: string;
  };
  availableFiles?: AvailableFile[];
  draft?: CommunicationDraft | null;
  missingLabels?: string[];
  records?: CommunicationRecord[];
};

type CommunicationListResponse = {
  rows?: CommunicationRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
};

type MailForm = {
  recipientEmails: string;
  ccEmails: string;
  emailLanguage: string;
  emailSubject: string;
  emailBody: string;
};

const LANGUAGE_OPTIONS = [
  { value: "EN", label: "英文" },
  { value: "ZH", label: "中文" },
  { value: "RU", label: "俄文" },
];

export function CustomerCommunicationModule({
  currentUser,
  permissions,
  initialKeyword = "",
  initialOrderId = "",
  initialOpenToken = 0,
}: {
  currentUser: User;
  permissions?: PermissionSnapshot;
  initialKeyword?: string;
  initialOrderId?: string;
  initialOpenToken?: number;
}) {
  const [rows, setRows] = useState<CommunicationRow[]>([]);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailOrderId, setDetailOrderId] = useState("");
  const [detail, setDetail] = useState<CommunicationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [mailForm, setMailForm] = useState<MailForm | null>(null);
  const [sending, setSending] = useState(false);

  const canSendByPermission = canWritePermission(currentUser, permissions, "customerCommunication", ["管理员", "业务员"]);
  const activeMissingLabels = detail?.missingLabels || detail?.draft?.missingLabels || [];
  const canSend = Boolean(detail?.canSend && canSendByPermission && !activeMissingLabels.length);

  useEffect(() => {
    void loadRows(1, initialKeyword);
  }, []);

  useEffect(() => {
    if (!initialOpenToken) return;
    setKeyword(initialKeyword);
    void loadRows(1, initialKeyword).then((nextRows) => {
      const row = initialOrderId
        ? nextRows.find((item) => item.id === initialOrderId)
        : nextRows.find((item) => (item.orderNo || "").includes(initialKeyword));
      if (row) void openDetail(row.id);
    });
  }, [initialOpenToken, initialKeyword, initialOrderId]);

  async function loadRows(nextPage = page, nextKeyword = keyword) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<CommunicationListResponse>(`/api/customer-communications?${params.toString()}`);
      const nextRows = data.rows || [];
      setRows(nextRows);
      setPage(Number(data.page || nextPage));
      setTotal(Number(data.total || nextRows.length));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "读取客户沟通列表失败";
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(orderId: string) {
    setDetailOrderId(orderId);
    setDetail(null);
    setMailForm(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const data = await apiJson<CommunicationDetail>(`/api/customer-communications/${encodeURIComponent(orderId)}`);
      setDetail(data);
      setMailForm(formFromDraft(data.draft || null));
    } catch (loadError) {
      setDetailError(loadError instanceof Error ? loadError.message : "读取客户沟通详情失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    if (sending) return;
    setDetailOrderId("");
    setDetail(null);
    setMailForm(null);
    setDetailError("");
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadRows(1, keyword);
  }

  function updateLanguage(language: string) {
    if (!mailForm || !detail?.draft) return;
    setMailForm({ ...mailForm, ...templateFromDraft(detail.draft, language), emailLanguage: language });
  }

  async function sendClearanceDocuments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detailOrderId || !mailForm) return;
    if (activeMissingLabels.length) {
      setDetailError(`附件缺失，不能发送：${activeMissingLabels.join("、")}`);
      return;
    }
    setSending(true);
    setDetailError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; detail?: CommunicationDetail }>(
        `/api/customer-communications/${encodeURIComponent(detailOrderId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            action: "sendCustomsClearanceDocs",
            recipientEmails: mailForm.recipientEmails,
            ccEmails: mailForm.ccEmails,
            emailLanguage: mailForm.emailLanguage,
            emailSubject: mailForm.emailSubject,
            emailBody: mailForm.emailBody,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "清关资料发送失败");
      const nextDetail = result.detail || await apiJson<CommunicationDetail>(`/api/customer-communications/${encodeURIComponent(detailOrderId)}`);
      setDetail(nextDetail);
      setMailForm(formFromDraft(nextDetail.draft || null));
      setNotice(result.message || "清关资料已发送");
      void loadRows(page, keyword);
    } catch (sendError) {
      const message = sendError instanceof ApiRequestError || sendError instanceof Error ? sendError.message : "清关资料发送失败";
      setDetailError(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={`${styles.moduleCard} ${styles.logisticsTypographyScope}`}>
      <div className={styles.moduleHeader}>
        <div>
          <h2>客户沟通</h2>
          <p>按订单集中处理客户清关资料邮件和发送记录。</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void loadRows(page, keyword)}>
            刷新
          </button>
        </div>
      </div>

      {notice ? <div className={styles.inlineSuccess}>{notice}</div> : null}
      {error ? <div className={styles.inlineError}>{error}</div> : null}

      <form className={styles.headerActions} onSubmit={submitSearch}>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="订单号 / 客户简称 / 提单号"
        />
        <button className={styles.primaryButtonCompact} type="submit" disabled={loading}>查询</button>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => {
          setKeyword("");
          void loadRows(1, "");
        }}>重置</button>
      </form>

      <div className={styles.tableWrap}>
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户简称</th>
              <th>提单号</th>
              <th>业务主体</th>
              <th>申报日期</th>
              <th>物流状态</th>
              <th>清关资料发送状态</th>
              <th>最近发送时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9}><div className={styles.emptyState}>正在加载客户沟通列表...</div></td></tr>
            ) : rows.length ? rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.orderNo || "-"}</strong></td>
                <td>{row.customerShortName || "-"}</td>
                <td>{row.billOfLadingNo || "-"}</td>
                <td>{row.businessEntityName || "-"}</td>
                <td>{formatDate(row.declarationDate)}</td>
                <td>{row.logisticsStatus || "-"}</td>
                <td><StatusBadge row={row} /></td>
                <td>{formatDateTime(row.latestSentAt)}</td>
                <td><button className={styles.secondaryButton} type="button" onClick={() => void openDetail(row.id)}>详情</button></td>
              </tr>
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>未找到客户沟通订单</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <PaginationBar total={total} page={page} totalPages={totalPages} loading={loading} onPage={(nextPage) => void loadRows(nextPage, keyword)} />

      {detailOrderId ? (
        <CustomerCommunicationDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          form={mailForm}
          canSend={canSend}
          sending={sending}
          missingLabels={activeMissingLabels}
          onClose={closeDetail}
          onSubmit={sendClearanceDocuments}
          onFormChange={setMailForm}
          onLanguageChange={updateLanguage}
        />
      ) : null}
    </section>
  );
}

function CustomerCommunicationDrawer({
  detail,
  loading,
  error,
  form,
  canSend,
  sending,
  missingLabels,
  onClose,
  onSubmit,
  onFormChange,
  onLanguageChange,
}: {
  detail: CommunicationDetail | null;
  loading: boolean;
  error: string;
  form: MailForm | null;
  canSend: boolean;
  sending: boolean;
  missingLabels: string[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFormChange: (form: MailForm) => void;
  onLanguageChange: (language: string) => void;
}) {
  const customer = detail?.customer || {};
  const files = detail?.availableFiles || [];
  const records = detail?.records || [];
  function setField<K extends keyof MailForm>(key: K, value: MailForm[K]) {
    if (!form) return;
    onFormChange({ ...form, [key]: value });
  }
  return (
    <DismissibleLayer
      ariaLabel="客户沟通详情"
      overlayClassName={styles.drawerOverlay}
      surfaceClassName={styles.taxRefundDrawer}
      dismissible
      dismissConfirmMessage={sending ? "邮件正在发送，确定关闭吗？" : ""}
      onClose={onClose}
    >
      {({ requestClose }) => (
        <>
          <header className={styles.taxRefundDrawerHeader}>
            <div className={styles.taxRefundDrawerTitle}>
              <span>客户沟通详情</span>
              <strong>{detail?.order?.orderNo || "-"}</strong>
              <small>{customer.shortName || detail?.order?.customerShortName || "-"}</small>
            </div>
            <div className={styles.taxRefundDrawerActions}>
              <button className={styles.ghostButton} type="button" onClick={requestClose} disabled={sending}>关闭</button>
            </div>
          </header>

          <div className={styles.taxRefundDrawerBody}>
            {loading ? <div className={styles.emptyState}>正在加载客户沟通详情...</div> : null}
            {error ? <div className={styles.inlineError}>{error}</div> : null}
            {!loading && detail ? (
              <div className={styles.documentGroupGrid}>
                <section className={styles.documentGroupCard}>
                  <strong>客户资料</strong>
                  <div className={styles.detailGrid}>
                    <DetailField label="客户全称" value={customer.fullName || "-"} wide />
                    <DetailField label="客户简称" value={customer.shortName || "-"} />
                    <DetailField label="默认收件邮箱" value={(customer.defaultToEmails || []).join(", ") || "-"} wide />
                    <DetailField label="默认抄送邮箱" value={(customer.defaultCcEmails || []).join(", ") || "-"} wide />
                    <DetailField label="语言偏好" value={languageLabel(customer.languagePreference)} />
                  </div>
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>可发送文件</strong>
                  <div className={styles.shippingDocsList}>
                    {files.map((file) => (
                      <span key={file.key} className={file.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                        {file.exists ? "✓" : "!"} {file.label}
                        {file.exists && Number(file.fileCount || 0) > 1 ? ` · 共 ${file.fileCount} 份` : ""}
                        {file.requiredForClearance ? " · 必需" : ""}
                      </span>
                    ))}
                  </div>
                  {missingLabels.length ? <div className={styles.inlineError}>缺失文件：{missingLabels.join("、")}</div> : null}
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>邮件发送</strong>
                  {form ? (
                    <form className={styles.shippingDocsForm} onKeyDown={preventEnterFormSubmit} onSubmit={onSubmit}>
                      <div className={styles.shippingDocsFormGrid}>
                        <label>
                          邮件语言
                          <select value={form.emailLanguage} onChange={(event) => onLanguageChange(event.target.value)}>
                            {LANGUAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                        </label>
                        <label>
                          收件人
                          <textarea value={form.recipientEmails} onChange={(event) => setField("recipientEmails", event.target.value)} rows={3} required />
                        </label>
                        <label>
                          抄送
                          <textarea value={form.ccEmails} onChange={(event) => setField("ccEmails", event.target.value)} rows={3} />
                        </label>
                        <label className={styles.shippingDocsWideField}>
                          邮件标题
                          <input value={form.emailSubject} onChange={(event) => setField("emailSubject", event.target.value)} required />
                        </label>
                        <label className={styles.shippingDocsWideField}>
                          邮件正文
                          <textarea value={form.emailBody} onChange={(event) => setField("emailBody", event.target.value)} rows={8} required />
                        </label>
                      </div>
                      <div className={styles.documentGroupCard}>
                        <strong>附件勾选</strong>
                        <div className={styles.shippingDocsList}>
                          {(detail.draft?.documents || []).map((item) => (
                            <label key={item.typeKey || item.label} className={item.exists ? styles.shippingDocReady : styles.shippingDocMissing}>
                              <input type="checkbox" checked={Boolean(item.exists)} disabled readOnly />
                              {item.label || item.emailLabel || "-"}
                              {item.exists && Number(item.fileCount || 0) > 1 ? ` · 共 ${item.fileCount} 份` : ""}
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className={styles.modalFooter}>
                        <button className={styles.secondaryButton} type="button" disabled={sending} onClick={() => {
                          window.alert(`${form.emailSubject}\n\n${form.emailBody}`);
                        }}>预览</button>
                        <button className={styles.primaryButtonCompact} type="submit" disabled={sending || !canSend}>
                          {sending ? "发送中..." : "手动发送"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={styles.emptyState}>暂无可发送邮件草稿</div>
                  )}
                </section>

                <section className={styles.documentGroupCard}>
                  <strong>发送记录</strong>
                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>发送时间</th>
                          <th>发送人</th>
                          <th>收件人</th>
                          <th>抄送</th>
                          <th>邮件类型</th>
                          <th>附件清单</th>
                          <th>发送状态</th>
                          <th>失败原因</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.length ? records.map((record) => (
                          <tr key={record.id}>
                            <td>{formatDateTime(record.sentAt || record.createdAt)}</td>
                            <td>{record.sentByName || "-"}</td>
                            <td>{(record.recipientEmails || []).join(", ") || "-"}</td>
                            <td>{(record.ccEmails || []).join(", ") || "-"}</td>
                            <td>{record.emailTypeLabel || "-"}</td>
                            <td>{attachmentText(record)}</td>
                            <td>{record.sendStatusLabel || record.sendStatus || "-"}</td>
                            <td>{record.errorMessage || "-"}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={8}><div className={styles.emptyState}>暂无发送记录</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </>
      )}
    </DismissibleLayer>
  );
}

function StatusBadge({ row }: { row: CommunicationRow }) {
  const danger = ["FAILED", "MISSING"].includes(String(row.clearanceStatus || ""));
  const success = row.clearanceStatus === "SENT";
  const className = `${styles.statusBadge} ${success ? styles.statusBadgeSuccess : danger ? styles.statusBadgeDanger : ""}`;
  return <span className={className}>{row.clearanceStatusLabel || "-"}</span>;
}

function formFromDraft(draft: CommunicationDraft | null): MailForm | null {
  if (!draft) return null;
  return {
    recipientEmails: (draft.recipientEmails || []).join("\n"),
    ccEmails: (draft.ccEmails || []).join("\n"),
    emailLanguage: String(draft.language || "EN").toUpperCase(),
    emailSubject: draft.subject || "",
    emailBody: draft.body || "",
  };
}

function templateFromDraft(draft: CommunicationDraft, language: string) {
  const labels = (draft.documents || []).filter((item) => item.exists).map((item) => item.emailLabel || item.label || "");
  const lines = (labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"]).map((label) => `- ${label}`).join("\n");
  const orderNo = draft.orderNo || "-";
  const blNo = draft.blNo || draft.billOfLadingNo || "-";
  const customsDate = draft.customsDeclarationDate || "-";
  if (language === "ZH") {
    return {
      emailSubject: `订单 ${orderNo} / 提单 ${blNo} 清关资料`,
      emailBody: ["您好！", "", "请查收本邮件附件中的清关资料：", "", lines, "", `提单号：${blNo}`, `申报日期：${customsDate}`, "", "NEXTWOOD"].join("\n"),
    };
  }
  if (language === "RU") {
    return {
      emailSubject: `Отгрузочные документы по заказу ${orderNo} / коносамент ${blNo}`,
      emailBody: ["Здравствуйте!", "", `Во вложении направляем отгрузочные документы по заказу ${orderNo}.`, "", "Документы во вложении:", lines, "", `Номер коносамента: ${blNo}`, `Дата декларации: ${customsDate}`, "", "С уважением,", "Zhejiang Lainuo Building Materials Co., Ltd."].join("\n"),
    };
  }
  return {
    emailSubject: `Shipping Documents for Order ${orderNo} / B/L ${blNo}`,
    emailBody: ["Dear Customer,", "", "Please find attached the shipping documents for your customs clearance:", "", lines, "", "This email also serves as the shipment notification.", "", "Best regards,", "NEXTWOOD"].join("\n"),
  };
}

function languageLabel(value = "") {
  if (value === "ZH") return "中文";
  if (value === "RU") return "俄文";
  return "英文";
}

function attachmentText(record: CommunicationRecord) {
  const attachments = record.attachments || [];
  if (attachments.length) {
    return attachments.map((item) => item.fileName || item.originalFilename || item.documentTypeLabel || "-").join("、");
  }
  return (record.documentTypes || []).join("、") || "-";
}
