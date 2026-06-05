import { apiError, getActor, listAvailableSuppliers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ suppliers: await listAvailableSuppliers(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取可用供应商失败");
  }
}
