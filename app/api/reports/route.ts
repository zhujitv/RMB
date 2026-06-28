import type { NextRequest } from "next/server";
import { withApiRead } from "../../../lib/api-route-guard";
import { exportReport, queryReport } from "../../../lib/report-service";

export const dynamic = "force-dynamic";

const LEGACY_TYPES = {
  orders: "receivables",
  profit: "profits",
  reminders: "overdue",
  "commissions-xlsx": "commissions",
};

type LegacyTypeKey = keyof typeof LEGACY_TYPES;

export const GET = withApiRead("reports", async (request: NextRequest, actor) => {
  const query = new URL(request.url).searchParams;
  const rawType = query.get("type") || "receivables";
  const type = LEGACY_TYPES[rawType as LegacyTypeKey] || rawType;
  return Response.json(await queryReport(type, query, actor));
}, { errorMessage: "查询报表失败" });

export const POST = withApiRead("reports", async (request: NextRequest, actor) => (
  exportReport(request, actor)
), { errorMessage: "下载报表失败" });
