import { apiError, getActor, listPayments, ok, savePayment } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    return ok({ payments: await listPayments(new URL(request.url).searchParams, actor) });
  } catch (error) {
    return apiError(error, "读取收款失败");
  }
}

export async function POST(request) {
  try {
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ payment: await savePayment(request, actor, body) });
  } catch (error) {
    return apiError(error, "保存收款失败");
  }
}
