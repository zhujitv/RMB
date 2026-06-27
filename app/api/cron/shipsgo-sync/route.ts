import type { NextRequest } from "next/server";
import { apiError, assertCronSecret, getCronActor, ok, syncDueShipsgoOceanTrackings } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type ErrorWithStatus = Error & {
  status?: number;
};

export async function GET(request: NextRequest) {
  try {
    assertCronSecret(request);
    const actor = await getCronActor();
    if (!actor) {
      const error: ErrorWithStatus = new Error("没有可用于执行大掌櫃同步任务的管理员账号");
      error.status = 500;
      throw error;
    }
    const result = await syncDueShipsgoOceanTrackings(request, actor);
    return ok(result);
  } catch (error: unknown) {
    return apiError(error, "大掌櫃定时同步失败");
  }
}
