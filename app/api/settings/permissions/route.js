import { apiError, getActor, getPermissionConfig, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ permissions: getPermissionConfig(actor) });
  } catch (error) {
    return apiError(error, "读取权限配置失败");
  }
}
