import type { NextRequest } from "next/server";
import { withApiRead } from "../../../../lib/api-route-guard";
import { exportReport } from "../../../../lib/report-service";

export const dynamic = "force-dynamic";

export const POST = withApiRead("reports", async (request: NextRequest, actor) => (
  exportReport(request, actor)
), { errorMessage: "下载报表失败" });
