import { apiError, getActor, listSuppliers, ok, saveSupplier } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ suppliers: await listSuppliers(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取供应商失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ supplier: await saveSupplier(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存供应商失败");
  }
}
