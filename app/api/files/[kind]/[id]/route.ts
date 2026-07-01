import type { NextRequest } from "next/server";
import { apiError, getManagedFileMetadata, ok } from "../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ kind: string; id: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { kind, id } = await params;
    const file = await getManagedFileMetadata(request, actor, kind, id);
    return ok({ success: true, file });
  } catch (error: unknown) {
    return apiError(error, "读取文件信息失败");
  }
}
