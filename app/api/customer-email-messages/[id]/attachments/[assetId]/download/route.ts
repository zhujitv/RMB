import type { NextRequest } from "next/server";
import {
  apiError,
  readCustomerCrmEmailAttachment,
} from "../../../../../../../lib/platform-db";
import { requireApiActor } from "../../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; assetId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id, assetId } = await params;
    const file = await readCustomerCrmEmailAttachment(actor, id, assetId);
    return new Response(file.body, { headers: file.headers });
  } catch (error: unknown) {
    return apiError(error, "下载邮件附件失败");
  }
}
