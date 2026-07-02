import { NextResponse, type NextRequest } from "next/server";
import { apiError, listCompanyHs, ok, parseJsonBody, saveCompanyHs } from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ success: true, items: await listCompanyHs(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取企业HS编码失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request) as Record<string, unknown>;
    const item = await saveCompanyHs(request, actor, body);
    return NextResponse.json({ success: true, item, message: "企业HS编码已保存" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存企业HS编码失败");
  }
}
