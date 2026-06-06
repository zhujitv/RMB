import { apiError, getActor } from "../../../lib/platform-db";
import { exportReport, queryReport } from "../../../lib/report-service";

export const dynamic = "force-dynamic";

const LEGACY_TYPES = {
  orders: "receivables",
  profit: "profits",
  reminders: "overdue",
  "commissions-xlsx": "commissions",
};

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const rawType = query.get("type") || "receivables";
    const type = LEGACY_TYPES[rawType] || rawType;
    return Response.json(await queryReport(type, query, actor));
  } catch (error) {
    return apiError(error, "查询报表失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    return await exportReport(request, actor);
  } catch (error) {
    return apiError(error, "下载报表失败");
  }
}
