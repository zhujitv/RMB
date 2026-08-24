import type { CustomerOpportunityStage } from "../generated/prisma/client.js";

type ContactSnapshot = { name: string; phone: string | null; email: string | null };
type OpportunityState = { stage: CustomerOpportunityStage; closedAt: Date | null; ownerUserId: string | null };

export const OPPORTUNITY_STAGE_PROBABILITY: Record<CustomerOpportunityStage, number> = {
  LEAD: 10,
  QUALIFIED: 30,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  WON: 100,
  LOST: 0,
};

export type OpportunityAttention = "CLOSED" | "OVERDUE" | "TODAY" | "UPCOMING" | "UNPLANNED";

function chinaDayNumber(value: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: "year" | "month" | "day") => Number(parts.find((item) => item.type === type)?.value || 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

export function opportunityAttention(stage: CustomerOpportunityStage, dueAt: Date | string | null, now = new Date()): OpportunityAttention {
  if (stage === "WON" || stage === "LOST") return "CLOSED";
  if (!dueAt) return "UNPLANNED";
  const due = chinaDayNumber(dueAt); const today = chinaDayNumber(now);
  if (due < today) return "OVERDUE";
  if (due === today) return "TODAY";
  return "UPCOMING";
}

export function customerContactSnapshotPatch(beforeWasPrimary: boolean, next: ContactSnapshot & { isPrimary: boolean }) {
  if (next.isPrimary) return { contactPerson: next.name, contactPhone: next.phone, contactEmail: next.email };
  if (beforeWasPrimary) return { contactPerson: null, contactPhone: null, contactEmail: null };
  return null;
}

export function opportunityLifecycle(
  before: OpportunityState | null,
  nextStage: CustomerOpportunityStage,
  requestedOwnerId: string | null,
  ownerWasProvided: boolean,
  actorId: string,
  now = new Date(),
) {
  const terminal = nextStage === "WON" || nextStage === "LOST";
  const wasTerminal = before?.stage === "WON" || before?.stage === "LOST";
  return {
    ownerUserId: ownerWasProvided ? requestedOwnerId : before ? before.ownerUserId : actorId,
    closedAt: terminal ? (wasTerminal && before?.closedAt ? before.closedAt : now) : null,
  };
}
