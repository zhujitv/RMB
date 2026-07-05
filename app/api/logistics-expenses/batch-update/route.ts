import type { NextRequest } from "next/server";
import { apiError, codedError } from "../../../../lib/platform-db";

import { requireApiActor } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    await requireApiActor(request);
    throw codedError("该保存入口已停用，请使用账单级批量保存接口。", 410, "LOGISTICS_EXPENSE_BATCH_UPDATE_DEPRECATED");
  } catch (error: unknown) {
    return apiError(error, "保存本账单明细失败");
  }
}
