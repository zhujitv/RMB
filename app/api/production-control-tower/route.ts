import type { NextRequest } from "next/server";
import { apiError, loadProductionControlTower, ok } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try { const actor = await requireApiActor(request); return ok({ data: await loadProductionControlTower(actor) }); }
  catch (error) { return apiError(error, "读取生产交期总控失败"); }
}
