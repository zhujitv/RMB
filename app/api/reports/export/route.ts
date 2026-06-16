import type { NextRequest } from "next/server";
import { apiError, getActor } from "../../../../lib/platform-db";
import { exportReport } from "../../../../lib/report-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return await exportReport(request, actor);
  } catch (error: unknown) {
    return apiError(error, "下载报表失败");
  }
}
