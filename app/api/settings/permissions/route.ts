import type { NextRequest } from "next/server";
import { apiError, getActor, getPermissionConfig, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ permissions: getPermissionConfig(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取权限配置失败");
  }
}
