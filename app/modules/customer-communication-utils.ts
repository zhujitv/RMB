import type { CommunicationDraft, CommunicationRow, MailForm } from "./customer-communication-types";

export type ManualMarkDialogState = {
  row: CommunicationRow;
  deliveryMethod: string;
  sentAt: string;
  remark: string;
};

export function currentDateTimeLocalValue() {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

export function formFromDraft(draft: CommunicationDraft | null): MailForm | null {
  if (!draft) return null;
  return {
    recipientEmails: (draft.recipientEmails || []).join("\n"),
    ccEmails: (draft.ccEmails || []).join("\n"),
    emailLanguage: String(draft.language || "EN").toUpperCase(),
    emailSubject: draft.subject || "",
    emailBody: draft.body || "",
  };
}

export function templateFromDraft(draft: CommunicationDraft, language: string) {
  const labels = (draft.documents || [])
    .filter((item) => item.exists)
    .map((item) => item.emailLabel || item.label || "");
  const lines = (labels.length ? labels : ["Commercial Invoice", "Packing List", "Customs Declaration"])
    .map((label) => `- ${label}`)
    .join("\n");
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
