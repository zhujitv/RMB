import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, listCustomers, ok, saveCustomer } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

const saveCustomerTyped = saveCustomer as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

const listCustomersTyped = listCustomers as (
  query: URLSearchParams,
  actor: unknown,
  options?: Record<string, unknown>,
) => Promise<unknown[]>;

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ customers: await listCustomersTyped(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取客户失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = (await request.json()) as Record<string, unknown>;
    const customer = await saveCustomerTyped(request, actor, body);
    return NextResponse.json({
      success: true,
      data: customer,
      message: "客户资料已保存",
    }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存客户失败");
  }
}
