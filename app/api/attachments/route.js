import { apiError, getActor, listAttachments, ok, saveAttachment } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ attachments: await listAttachments(query, actor) });
  } catch (error) {
    return apiError(error, "读取附件失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ attachment: await saveAttachment(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存附件失败");
  }
}
