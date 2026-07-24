"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, apiJson } from "../api";
import type { PermissionSnapshot, User } from "../types";
import { canWritePermission } from "../utils";
import { useWorkspaceTabBusy, useWorkspaceTabDirty, useWorkspaceTabPresentation, useWorkspaceTabReactivation } from "../workspace/workspace-tab-context";
import { CustomerCommunicationDrawer } from "./customer-communication-drawer";
import { CustomerCommunicationList } from "./customer-communication-list";
import { ManualMarkDialog } from "./customer-communication-manual-dialog";
import type { CommunicationDetail, CommunicationListResponse, CommunicationRow, MailForm } from "./customer-communication-types";
import { formFromDraft, templateFromDraft } from "./customer-communication-utils";
import { useCustomerCommunicationManualMark } from "./use-customer-communication-manual-mark";

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
  const listRequestRef = useRef(0);
  const {
    manualMarkDialog,
    setManualMarkDialog,
    manualMarkBusyId,
    manualMarkError,
    openManualMarkDialog,
    submitManualMark,
    unmarkManualSent,
  } = useCustomerCommunicationManualMark({
    detailOrderId,
    setRows,
    setDetail,
    setMailForm,
    setError,
    setNotice,
  });

  const canSendByPermission = canWritePermission(currentUser, permissions, "customerCommunication", ["管理员", "业务员"]);
  const canManualMark = canSendByPermission && ["管理员", "业务员"].includes(currentUser.role);
  const activeMissingLabels = detail?.missingLabels || detail?.draft?.missingLabels || [];
  const canSend = Boolean(detail?.canSend && canSendByPermission && !activeMissingLabels.length);
  const activeCommunicationRow = detail?.order || rows.find((row) => row.id === detailOrderId);
  const baselineMailForm = formFromDraft(detail?.draft || null);
  const mailFormDirty = Boolean(
    detailOrderId
    && mailForm
    && JSON.stringify(mailForm) !== JSON.stringify(baselineMailForm),
  );

  useWorkspaceTabPresentation({
    title: detailOrderId
      ? `客户沟通 · ${activeCommunicationRow?.orderNo || "订单详情"}`
      : manualMarkDialog
        ? `标记发送 · ${manualMarkDialog.row.orderNo || "订单"}`
        : "客户沟通",
    view: detailOrderId || manualMarkDialog ? "edit" : "list",
    contextKey: detailOrderId
      ? `communication:${detailOrderId}`
      : manualMarkDialog
        ? `manual-mark:${manualMarkDialog.row.id}`
        : "list:customer-communication",
    ensureListTab: Boolean(detailOrderId || manualMarkDialog),
  });
  useWorkspaceTabDirty(mailFormDirty || Boolean(manualMarkDialog));
  useWorkspaceTabBusy(sending || Boolean(manualMarkBusyId));
  useWorkspaceTabReactivation(() => {
    void loadRows(page, keyword);
  });

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
    if (language === mailForm.emailLanguage) return;
    const currentTemplate = templateFromDraft(detail.draft, mailForm.emailLanguage);
    const hasManualContent = mailForm.emailSubject !== currentTemplate.emailSubject
      || mailForm.emailBody !== currentTemplate.emailBody;
    if (hasManualContent && !window.confirm("切换语言将替换当前邮件标题和正文，确定继续吗？")) return;
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
    <>
      <CustomerCommunicationList
        rows={rows}
        keyword={keyword}
        total={total}
        page={page}
        totalPages={totalPages}
        loading={loading}
        error={error}
        notice={notice}
        canManualMark={canManualMark}
        manualMarkBusyId={manualMarkBusyId}
        onKeywordChange={setKeyword}
        onSearch={submitSearch}
        onReset={() => { setKeyword(""); void loadRows(1, ""); }}
        onRefresh={() => void loadRows(page, keyword)}
        onPage={(nextPage) => void loadRows(nextPage, keyword)}
        onOpenDetail={(orderId) => void openDetail(orderId)}
        onToggleManualMark={(row) => {
          if (row.manualMarked) void unmarkManualSent(row);
          else openManualMarkDialog(row);
        }}
      />
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
        <ManualMarkDialog
          state={manualMarkDialog}
          error={manualMarkError}
          busy={Boolean(manualMarkBusyId)}
          onChange={setManualMarkDialog}
          onSubmit={submitManualMark}
          onClose={() => setManualMarkDialog(null)}
        />
      ) : null}
    </>
  );
}
