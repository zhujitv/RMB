import { apiError, getActor, ok, uploadLogisticsExpenseInvoice } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const formData = await request.formData();
    const expense = await uploadLogisticsExpenseInvoice(request, actor, id, formData);
    return ok({ success: true, expense, message: "物流发票已上传" }, { status: 201 });
  } catch (error) {
    return apiError(error, "上传物流发票失败");
  }
}
