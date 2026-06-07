import { apiError, getActor, ok, requestDomesticLogisticsCorrection } from "../../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const actor = await getActor(request);
    const { id } = await params;
    const body = await request.json();
    const info = await requestDomesticLogisticsCorrection(request, actor, id, body);
    return ok({ success: true, info, message: "更正申请已提交" });
  } catch (error) {
    return apiError(error, "提交更正申请失败");
  }
}
