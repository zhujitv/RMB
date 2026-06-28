import type { NextRequest } from "next/server";
import { apiError, deleteShipsgoOceanTracking, ok } from "../../../../../lib/platform-db";

import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    const result = await deleteShipsgoOceanTracking(request, actor, id);
    return ok({ success: true, ...result });
  } catch (error: unknown) {
    return apiError(error, "删除大掌櫃跟踪失败");
  }
}
