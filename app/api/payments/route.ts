import { NextResponse, type NextRequest } from "next/server";
import { listPayments, ok, parseJsonBody, savePayment } from "../../../lib/platform-db";

import { withApiRead, withApiWrite } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

const savePaymentTyped = savePayment as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

const listPaymentsTyped = listPayments as (
  query: URLSearchParams,
  actor: unknown,
  options?: { paginated?: boolean },
) => Promise<unknown[] | { rows: unknown[] }>;

export const GET = withApiRead("payments", async (request, actor) => {
    const query = new URL(request.url).searchParams;
    const paginated = query.get("workspace") === "1" || query.has("page") || query.has("pageSize");
    const result = await listPaymentsTyped(query, actor, { paginated });
    const page = result as { rows: unknown[] };
    return paginated
      ? ok({ success: true, data: result, payments: page.rows || [] })
      : ok({ payments: result });
}, { errorMessage: "读取收款失败" });

export const POST = withApiWrite("payments", async (request, actor) => {
    const body = await parseJsonBody(request);
    const payment = await savePaymentTyped(request, actor, body);
    return NextResponse.json({ success: true, payment, message: "收款已保存" }, { status: 201 });
}, { errorMessage: "保存收款失败" });
