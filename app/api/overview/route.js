import { apiError, getActor, getOverview, ok, requireAdminGlobal } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    requireAdminGlobal(actor, "无权限访问经营总览");
    return ok({ overview: await getOverview(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取总览失败");
  }
}
