import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, uploadLogisticsExpenseInvoice } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const formData = await request.formData();
    const result = await uploadLogisticsExpenseInvoice(request, actor, id, formData);
    return NextResponse.json({ success: true, ...result, message: "物流发票已上传" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "上传物流发票失败");
  }
}
