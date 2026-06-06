import { apiError, getActor } from "../../../../lib/platform-db";
import { exportReport } from "../../../../lib/report-service";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const actor = await getActor(request);
    return await exportReport(request, actor);
  } catch (error) {
    return apiError(error, "下载报表失败");
  }
}
