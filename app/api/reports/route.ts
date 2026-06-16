import type { NextRequest } from "next/server";
import { apiError, getActor } from "../../../lib/platform-db";
import { exportReport, queryReport } from "../../../lib/report-service";

export const dynamic = "force-dynamic";

const LEGACY_TYPES = {
  orders: "receivables",
  profit: "profits",
  reminders: "overdue",
  "commissions-xlsx": "commissions",
};

type LegacyTypeKey = keyof typeof LEGACY_TYPES;

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const rawType = query.get("type") || "receivables";
    const type = LEGACY_TYPES[rawType as LegacyTypeKey] || rawType;
    return Response.json(await queryReport(type, query, actor));
  } catch (error: unknown) {
    return apiError(error, "查询报表失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return await exportReport(request, actor);
  } catch (error: unknown) {
    return apiError(error, "下载报表失败");
  }
}
