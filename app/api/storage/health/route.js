import { apiError, assertWrite, getActor, ok } from "../../../../lib/platform-db";
import { checkR2Storage } from "../../../../lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    assertWrite(actor, "settings");
    return ok({ storage: await checkR2Storage() });
  } catch (error) {
    return apiError(error, "检查文件存储服务失败");
  }
}
