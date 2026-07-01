import { type NextRequest } from "next/server";
import { apiError, listBusinessEntities, ok } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const entities = await listBusinessEntities(actor, {
      includeInactive: query.get("includeInactive") === "1",
    });
    return ok({ success: true, entities });
  } catch (error: unknown) {
    return apiError(error, "读取业务主体失败");
  }
}
