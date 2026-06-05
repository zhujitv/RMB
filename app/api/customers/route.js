import { apiError, getActor, listCustomers, ok, saveCustomer } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    return ok({ customers: await listCustomers(new URL(request.url).searchParams) });
  } catch (error) {
    return apiError(error, "读取客户失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ customer: await saveCustomer(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存客户失败");
  }
}
