import { NextResponse } from "next/server";
import { logServerError } from "./shared-base-utils";

export const TAX_REFUND_DATA_READ_FAILED_MESSAGE = "退税数据读取失败，请联系管理员。";

export function taxRefundDataReadFailure(error: unknown, context: Record<string, unknown> = {}) {
  logServerError("退税数据读取失败", error, context);
  return NextResponse.json(
    {
      error: TAX_REFUND_DATA_READ_FAILED_MESSAGE,
      code: "TAX_REFUND_DATA_READ_FAILED",
    },
    { status: 500 },
  );
}
