import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  listCustomerProducts,
  parseJsonBody,
  saveCustomerProduct,
} from "../../../lib/platform-db";
import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const data = await listCustomerProducts(new URL(request.url).searchParams, actor);
    return NextResponse.json({ success: true, data, products: data.rows });
  } catch (error: unknown) {
    return apiError(error, "读取客户产品失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const product = await saveCustomerProduct(request, actor, body);
    return NextResponse.json({
      success: true,
      data: product,
      product,
      message: "客户产品已保存",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存客户产品失败");
  }
}
