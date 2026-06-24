import { NextResponse, type NextRequest } from "next/server";
import { apiError, assertSameOriginRequest, parseJsonBody, registerUser } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginRequest(request);
    const body = await parseJsonBody(request);
    return NextResponse.json(
      { success: true, user: await registerUser(request, body), message: "注册申请已提交，请等待管理员审核。" },
      { status: 201 },
    );
  } catch (error: unknown) {
    return apiError(error, "提交注册申请失败");
  }
}
