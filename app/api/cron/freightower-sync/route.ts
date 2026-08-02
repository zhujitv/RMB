import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, getCronActor, ok, syncDueShipsgoOceanTrackings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & { status?: number };

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error: ErrorWithStatus = new Error("没有可用于执行飞驼可视同步任务的管理员账号");
      error.status = 500;
      throw error;
    }
    return ok(await syncDueShipsgoOceanTrackings(request, actor));
  } catch (error: unknown) {
    return apiError(error, "飞驼可视定时同步失败");
  }
}
