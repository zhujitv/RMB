import { NextResponse } from "next/server";
import { apiError, buildTaxRefundPackage, getActor, requireText } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const { buffer, fileName } = await buildTaxRefundPackage(
      request,
      actor,
      requireText(query.get("orderId"), "订单"),
      query.get("documentType") || "",
    );
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    return apiError(error, "下载退税资料包失败");
  }
}
