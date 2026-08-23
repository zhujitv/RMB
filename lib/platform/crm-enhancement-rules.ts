import type { CustomerOpportunityStage } from "../generated/prisma/client.js";

type ContactSnapshot = { name: string; phone: string | null; email: string | null };
type OpportunityState = { stage: CustomerOpportunityStage; closedAt: Date | null; ownerUserId: string | null };

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
