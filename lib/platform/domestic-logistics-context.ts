import { archiveScope } from "./domestic-logistics-ops";
import { codedError, nonEmpty } from "./shared";
import { writeAudit } from "./shared";

export type DomesticLogisticsInput = Record<string, unknown>;
export type DomesticLogisticsQuery = {
  get(key: string): string | null;
};
export type DomesticLogisticsListFilters = {
  keyword: string;
  businessScope: ReturnType<typeof archiveScope>;
};
export type DomesticLogisticsActorInput = {
  id?: string | null;
  role?: string | null;
  customPermissions?: unknown;
  supplierId?: string | null;
} | null | undefined;
export type DomesticLogisticsActor = {
  id: string;
  role?: string;
  customPermissions?: unknown;
  supplierId?: string | null;
};
export type AuditRequestLike = Parameters<typeof writeAudit>[0];
export const DOMESTIC_LOGISTICS_LIST_PAGE_SIZE_MAX = 20;

export function actorRole(actor: DomesticLogisticsActorInput) {
  return String(actor?.role || "");
}

export function requireDomesticLogisticsActor(actor: DomesticLogisticsActorInput): DomesticLogisticsActor {
  if (!actor?.id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return {
    id: actor.id,
    role: actor.role || undefined,
    customPermissions: actor.customPermissions,
    supplierId: actor.supplierId || null,
  };
}

export function domesticLogisticsListFiltersFromQuery(query: DomesticLogisticsQuery): DomesticLogisticsListFilters {
  const keyword = nonEmpty(query.get("keyword"));
  const businessScope = archiveScope(query);
  return { keyword, businessScope };
}
