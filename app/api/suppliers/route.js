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
    const supplier = await saveSupplier(request, actor, body);
    return ok({ success: true, supplier, message: "供应商已保存" }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存供应商失败");
  }
}
