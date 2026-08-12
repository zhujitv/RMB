import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  parseJsonBody,
  saveCustomerProduct,
  voidCustomerProduct,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const body = await parseJsonBody(request);
    const product = await saveCustomerProduct(request, actor, body, id);
    return NextResponse.json({
      success: true,
      data: product,
      product,
      message: "客户产品已保存",
    });
  } catch (error: unknown) {
    return apiError(error, "更新客户产品失败");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await params;
    const product = await voidCustomerProduct(request, actor, id);
    return NextResponse.json({
      success: true,
      data: product,
      product,
      message: "客户产品已作废",
    });
  } catch (error: unknown) {
    return apiError(error, "作废客户产品失败");
  }
}
