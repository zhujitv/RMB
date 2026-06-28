import type { NextRequest } from "next/server";
import {
  apiError,
  listCostInvoiceExceptions,
  listCostInvoiceGroups,
  listCostOrderSummaries,
  listCostsPage,
  ok,
  parseJsonBody,
  saveCost,
  saveCosts,
} from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const saveCostTyped = saveCost as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

const saveCostsTyped = saveCosts as (
  request: NextRequest,
  actor: unknown,
  input: { items?: unknown[] } & Record<string, unknown>,
) => Promise<unknown>;

const listCostOrderSummariesTyped = listCostOrderSummaries as (
  query: URLSearchParams,
  actor: unknown,
) => Promise<{ rows: unknown[] } & Record<string, unknown>>;

const listCostsPageTyped = listCostsPage as (
  query: URLSearchParams,
  actor: unknown,
) => Promise<{ rows: unknown[] } & Record<string, unknown>>;

const listCostInvoiceExceptionsTyped = listCostInvoiceExceptions as (
  query: URLSearchParams,
  actor: unknown,
) => Promise<{ rows: unknown[] } & Record<string, unknown>>;

const listCostInvoiceGroupsTyped = listCostInvoiceGroups as (
  query: URLSearchParams,
  actor: unknown,
) => Promise<{ rows: unknown[] } & Record<string, unknown>>;

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const view = query.get("view");
    const data = view === "orders"
      ? await listCostOrderSummariesTyped(query, actor)
      : view === "invoiceExceptions"
        ? await listCostInvoiceExceptionsTyped(query, actor)
        : view === "details"
          ? await listCostsPageTyped(query, actor)
          : await listCostInvoiceGroupsTyped(query, actor);
    return ok({ success: true, data, costs: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取成本失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request) as { items?: unknown[] } & Record<string, unknown>;
    if (Array.isArray(body.items)) {
      return ok({ success: true, costs: await saveCostsTyped(request, actor, body) });
    }
    return ok({ success: true, cost: await saveCostTyped(request, actor, body) });
  } catch (error: unknown) {
    return apiError(error, "保存成本失败");
  }
}
