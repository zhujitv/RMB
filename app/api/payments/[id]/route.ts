import type { NextRequest } from "next/server";
import { deletePayment, ok, parseJsonBody, savePayment } from "../../../../lib/platform-db";

import { withApiWrite } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const savePaymentTyped = savePayment as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

export const PATCH = withApiWrite<RouteContext>("payments", async (request, actor, { params }) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const payment = await savePaymentTyped(request, actor, body, id);
    return ok({ success: true, payment, message: "收款已保存" });
}, { errorMessage: "更新收款失败" });

export const DELETE = withApiWrite<RouteContext>("payments", async (request, actor, { params }) => {
    const { id } = await params;
    const expectedUpdatedAt = new URL(request.url).searchParams.get("expectedUpdatedAt");
    await deletePayment(request, actor, id, expectedUpdatedAt);
    return ok({ success: true, ok: true, message: "收款已删除" });
}, { errorMessage: "删除收款失败" });
