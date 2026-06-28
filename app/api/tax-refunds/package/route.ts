import { NextResponse, type NextRequest } from "next/server";
import { apiError, buildTaxRefundPackage, requireText } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    const { buffer, fileName } = await buildTaxRefundPackage(
      request,
      actor,
      requireText(query.get("orderId"), "订单"),
      query.get("documentType") || "",
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "下载退税资料包失败");
  }
}
