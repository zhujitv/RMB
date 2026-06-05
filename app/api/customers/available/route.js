import { apiError, getActor, listAvailableCustomers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ customers: await listAvailableCustomers(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取可用客户失败");
  }
}
