import type { NextRequest } from "next/server";
import {
  apiError,
  ok,
  parseJsonBody,
  readLogisticsInvoiceValidationRules,
  saveLogisticsInvoiceValidationRules,
} from "../../../../lib/platform-db";
import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    return ok({ rules: await readLogisticsInvoiceValidationRules(actor) });
  } catch (error: unknown) {
    return apiError(error, "读取物流费用发票校验规则失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const body = await parseJsonBody(request);
    const rules = await saveLogisticsInvoiceValidationRules(request, actor, body);
    return ok({ success: true, rules, message: "物流费用发票校验规则已保存" });
  } catch (error: unknown) {
    return apiError(error, "保存物流费用发票校验规则失败");
  }
}
