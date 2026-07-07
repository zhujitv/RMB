"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiRequestError, apiJson } from "../api";
import { PaginationBar } from "../components";
import { CustomerCommunicationDrawer } from "./customer-communication-drawer";
import { formatDate, formatDateTime } from "../formatters";
import styles from "../WorkspaceShell.module.css";
import type { PermissionSnapshot, User } from "../types";
import type { CommunicationDetail, CommunicationDraft, CommunicationListResponse, CommunicationRow, MailForm } from "./customer-communication-types";
import { canWritePermission } from "../utils";
import { getBusinessEntityRowClass } from "./business-entity-row-style";

const LANGUAGE_OPTIONS = [
  { value: "EN", label: "英文" },
  { value: "ZH", label: "中文" },
  { value: "RU", label: "俄文" },
];

const MANUAL_SEND_METHOD_OPTIONS = ["系统邮件", "手动邮件", "微信", "QQ", "WhatsApp", "客户平台", "其它"];

type ManualMarkDialogState = {
  row: CommunicationRow;
  deliveryMethod: string;
  sentAt: string;
  remark: string;
};

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
  const [manualMarkDialog, setManualMarkDialog] = useState<ManualMarkDialogState | null>(null);
  const [manualMarkBusyId, setManualMarkBusyId] = useState("");
  const [manualMarkError, setManualMarkError] = useState("");
  const listRequestRef = useRef(0);

  const canSendByPermission = canWritePermission(currentUser, permissions, "customerCommunication", ["管理员", "业务员"]);
  const canManualMark = canSendByPermission && ["管理员", "业务员"].includes(currentUser.role);
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
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "20" });
      if (nextKeyword.trim()) params.set("keyword", nextKeyword.trim());
      const data = await apiJson<CommunicationListResponse>(`/api/customer-communications?${params.toString()}`);
      if (requestId !== listRequestRef.current) return [];
      const nextRows = data.rows || [];
      setRows(nextRows);
      setPage(Number(data.page || nextPage));
      setTotal(Number(data.total || nextRows.length));
      setTotalPages(Math.max(1, Number(data.totalPages || 1)));
      return nextRows;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "读取客户沟通列表失败";
      if (requestId === listRequestRef.current) setError(message);
      return [];
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
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

  function updateRowFromDetail(nextDetail: CommunicationDetail) {
    if (!nextDetail.order?.id) return;
    setRows((current) => current.map((row) => (row.id === nextDetail.order.id ? { ...row, ...nextDetail.order } : row)));
    if (detailOrderId === nextDetail.order.id) {
      setDetail(nextDetail);
      setMailForm(formFromDraft(nextDetail.draft || null));
    }
  }

  function openManualMarkDialog(row: CommunicationRow) {
    setManualMarkError("");
    setManualMarkDialog({
      row,
      deliveryMethod: "手动邮件",
      sentAt: currentDateTimeLocalValue(),
      remark: "",
    });
  }

  async function submitManualMark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualMarkDialog) return;
    const row = manualMarkDialog.row;
    setManualMarkBusyId(row.id);
    setManualMarkError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; detail?: CommunicationDetail }>(
        `/api/customer-communications/${encodeURIComponent(row.id)}/mark-sent`,
        {
          method: "POST",
          body: JSON.stringify({
            deliveryMethod: manualMarkDialog.deliveryMethod,
            sentAt: manualMarkDialog.sentAt,
            remark: manualMarkDialog.remark,
          }),
        },
      );
      if (result.success !== true || !result.detail) throw new Error(result.message || "手动标记已发送失败");
      updateRowFromDetail(result.detail);
      setManualMarkDialog(null);
      setNotice(result.message || "已手动标记为已发送。");
    } catch (markError) {
      setManualMarkError(markError instanceof Error ? markError.message : "手动标记已发送失败");
    } finally {
      setManualMarkBusyId("");
    }
  }

  async function unmarkManualSent(row: CommunicationRow) {
    if (!window.confirm(`确认取消订单 ${row.orderNo || "-"} 的手动已发送标记？`)) return;
    setManualMarkBusyId(row.id);
    setError("");
    setNotice("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; detail?: CommunicationDetail }>(
        `/api/customer-communications/${encodeURIComponent(row.id)}/unmark-sent`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (result.success !== true || !result.detail) throw new Error(result.message || "取消手动发送标记失败");
      updateRowFromDetail(result.detail);
      setNotice(result.message || "已取消手动发送标记。");
    } catch (unmarkError) {
      setError(unmarkError instanceof Error ? unmarkError.message : "取消手动发送标记失败");
    } finally {
      setManualMarkBusyId("");
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
              <tr key={row.id} className={getBusinessEntityRowClass(row, styles)}>
                <td><strong>{row.orderNo || "-"}</strong></td>
                <td>{row.customerShortName || "-"}</td>
                <td>{row.billOfLadingNo || "-"}</td>
                <td>{row.businessEntityName || "-"}</td>
                <td>{formatDate(row.declarationDate)}</td>
                <td>{row.logisticsStatus || "-"}</td>
                <td><StatusBadge row={row} /></td>
                <td>{formatDateTime(row.latestSentAt)}</td>
                <td>
                  <div className={styles.inlineActionGroup}>
                    <button className={styles.secondaryButton} type="button" onClick={() => void openDetail(row.id)}>详情</button>
                    {canManualMark ? (
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        disabled={manualMarkBusyId === row.id}
                        onClick={() => {
                          if (row.manualMarked) {
                            void unmarkManualSent(row);
                          } else {
                            openManualMarkDialog(row);
                          }
                        }}
                      >
                        {manualMarkBusyId === row.id ? "处理中..." : manualMarkButtonLabel(row)}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={9}><div className={styles.emptyState}>未找到需要发送清关资料的订单</div></td></tr>
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

      {manualMarkDialog ? (
        <div className={styles.modalOverlay} role="presentation">
          <form className={styles.modalCard} onSubmit={submitManualMark}>
            <div className={styles.modalHeader}>
              <div>
                <strong>手动标记已发送</strong>
                <small>{manualMarkDialog.row.orderNo || "-"} · {manualMarkDialog.row.customerShortName || "-"}</small>
              </div>
              <button className={styles.ghostButton} type="button" disabled={Boolean(manualMarkBusyId)} onClick={() => setManualMarkDialog(null)}>关闭</button>
            </div>
            {manualMarkError ? <div className={styles.inlineError}>{manualMarkError}</div> : null}
            <div className={styles.shippingDocsFormGrid}>
              <label>
                发送方式
                <select
                  value={manualMarkDialog.deliveryMethod}
                  onChange={(event) => setManualMarkDialog({ ...manualMarkDialog, deliveryMethod: event.target.value })}
                  required
                >
                  {MANUAL_SEND_METHOD_OPTIONS.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              <label>
                发送时间
                <input
                  type="datetime-local"
                  value={manualMarkDialog.sentAt}
                  onChange={(event) => setManualMarkDialog({ ...manualMarkDialog, sentAt: event.target.value })}
                  required
                />
              </label>
              <label className={styles.shippingDocsWideField}>
                备注
                <textarea
                  value={manualMarkDialog.remark}
                  onChange={(event) => setManualMarkDialog({ ...manualMarkDialog, remark: event.target.value })}
                  rows={4}
                  placeholder="可填写微信、QQ、客户平台记录编号或人工邮件说明"
                />
              </label>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.secondaryButton} type="button" disabled={Boolean(manualMarkBusyId)} onClick={() => setManualMarkDialog(null)}>取消</button>
              <button className={styles.primaryButtonCompact} type="submit" disabled={Boolean(manualMarkBusyId)}>
                {manualMarkBusyId ? "提交中..." : "确认标记"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function StatusBadge({ row }: { row: CommunicationRow }) {
  const danger = ["FAILED", "MISSING"].includes(String(row.clearanceStatus || ""));
  const success = ["SENT", "MANUAL_SENT"].includes(String(row.clearanceStatus || ""));
  const className = `${styles.statusBadge} ${success ? styles.statusBadgeSuccess : danger ? styles.statusBadgeDanger : ""}`;
  return <span className={className}>{row.clearanceStatusLabel || "-"}</span>;
}

function manualMarkButtonLabel(row: CommunicationRow) {
  if (row.manualMarked || row.clearanceStatus === "MANUAL_SENT") return "取消标记";
  if (row.clearanceStatus === "SENT") return "重新标记";
  return "标记已发送";
}

function currentDateTimeLocalValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
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
