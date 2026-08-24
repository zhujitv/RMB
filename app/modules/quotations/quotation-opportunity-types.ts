import type { QuotationRow } from "./types";

export type OpportunityStage = "LEAD" | "QUALIFIED" | "PROPOSAL" | "NEGOTIATION" | "WON" | "LOST";
export type OpportunityAttention = "CLOSED" | "OVERDUE" | "TODAY" | "UPCOMING" | "UNPLANNED";
export type OpportunityActivityType = "WECHAT" | "PHONE" | "EMAIL" | "WHATSAPP" | "MEETING" | "SAMPLE" | "QUOTATION" | "FOLLOW_UP" | "OTHER";

export type OpportunityContact = { id: string; name: string; title?: string | null; department?: string | null; phone?: string | null; email?: string | null; isPrimary?: boolean };
export type OpportunityActivity = { id: string; type: OpportunityActivityType; subject: string; note?: string | null; outcome?: string | null; occurredAt: string; contact?: Pick<OpportunityContact, "id" | "name"> | null; createdBy?: { name?: string | null } | null };
export type OpportunityStageEvent = { id: string; fromStage?: OpportunityStage | null; toStage: OpportunityStage; note?: string | null; changedAt: string; changedBy?: { name?: string | null } | null };
export type Opportunity = {
  id: string; name: string; stage: OpportunityStage; attention: OpportunityAttention;
  amount?: string | number | null; currency: string; probability: number;
  expectedCloseDate?: string | null; nextAction?: string | null; nextActionDueAt?: string | null;
  lostReasonCode?: string | null; lostReason?: string | null; remark?: string | null;
  owner?: { name?: string | null } | null; updatedAt?: string | null;
  contactLinks: Array<{ id: string; isPrimary: boolean; role?: string | null; contact: OpportunityContact }>;
  quotations: QuotationRow[]; activities: OpportunityActivity[]; stageHistory: OpportunityStageEvent[];
};

export type OpportunityDraft = {
  name: string; stage: OpportunityStage; expectedCloseDate: string; nextAction: string; nextActionDueAt: string;
  contactIds: string[]; contactRoles: Record<string, string>; primaryContactId: string; quotationIds: string[];
  lostReasonCode: string; lostReason: string; remark: string;
};

export const OPPORTUNITY_STAGES: Array<{ value: OpportunityStage; label: string; probability: number }> = [
  { value: "LEAD", label: "询盘", probability: 10 },
  { value: "QUALIFIED", label: "需求已确认", probability: 30 },
  { value: "PROPOSAL", label: "已报价", probability: 50 },
  { value: "NEGOTIATION", label: "跟进 / 谈判", probability: 75 },
  { value: "WON", label: "已赢单", probability: 100 },
  { value: "LOST", label: "已丢单", probability: 0 },
];

export const LOST_REASON_OPTIONS = [
  ["PRICE", "价格原因"], ["PRODUCT", "产品不匹配"], ["DELIVERY", "交期原因"], ["COMPETITOR", "选择竞争对手"],
  ["BUDGET", "客户预算取消"], ["NO_DECISION", "项目暂停 / 无决策"], ["OTHER", "其他"],
] as const;

export const ATTENTION_LABEL: Record<OpportunityAttention, string> = {
  OVERDUE: "已逾期", TODAY: "今天处理", UPCOMING: "即将处理", UNPLANNED: "未安排", CLOSED: "已结束",
};

export const ACTIVITY_LABEL: Record<OpportunityActivityType, string> = {
  WECHAT: "微信", PHONE: "电话", EMAIL: "邮件", WHATSAPP: "WhatsApp", MEETING: "会议", SAMPLE: "寄样",
  QUOTATION: "报价", FOLLOW_UP: "跟进", OTHER: "其他",
};

export const CONTACT_ROLE_OPTIONS = ["决策人", "采购负责人", "技术影响人", "使用部门", "财务", "其他"] as const;

export const day = (value?: string | null) => value ? String(value).slice(0, 10) : "";
export const stageLabel = (stage: OpportunityStage) => OPPORTUNITY_STAGES.find((item) => item.value === stage)?.label || stage;

export function emptyOpportunityDraft(): OpportunityDraft {
  return { name: "", stage: "LEAD", expectedCloseDate: "", nextAction: "", nextActionDueAt: "", contactIds: [], contactRoles: {}, primaryContactId: "", quotationIds: [], lostReasonCode: "", lostReason: "", remark: "" };
}

export function opportunityToDraft(row?: Opportunity): OpportunityDraft {
  if (!row) return emptyOpportunityDraft();
  return {
    name: row.name, stage: row.stage, expectedCloseDate: day(row.expectedCloseDate), nextAction: row.nextAction || "", nextActionDueAt: day(row.nextActionDueAt),
    contactIds: row.contactLinks.map((link) => link.contact.id), contactRoles: Object.fromEntries(row.contactLinks.map((link) => [link.contact.id, link.role || ""])), primaryContactId: row.contactLinks.find((link) => link.isPrimary)?.contact.id || "",
    quotationIds: row.quotations.map((quote) => quote.id), lostReasonCode: row.lostReasonCode || "", lostReason: row.lostReason || "", remark: row.remark || "",
  };
}
