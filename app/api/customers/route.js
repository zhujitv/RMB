import { apiError, getActor, listCustomers, ok, saveCustomer } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ customers: await listCustomers(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取客户失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    const customer = await saveCustomer(request, actor, body);
    return ok({
      success: true,
      data: customer,
      message: "客户资料已保存",
    }, { status: 201 });
  } catch (error) {
    return apiError(error, "保存客户失败");
  }
}
