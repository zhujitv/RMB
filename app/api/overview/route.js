import { apiError, getActor, getOverview, ok } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ overview: await getOverview(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取总览失败");
  }
}
