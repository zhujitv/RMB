import { NextResponse, type NextRequest } from "next/server";
import { apiError, getActor, listSuppliers, ok, parseJsonBody, saveSupplier } from "../../../lib/platform-db";

export const dynamic = "force-dynamic";

const saveSupplierTyped = saveSupplier as (
  request: NextRequest,
  actor: unknown,
  input: Record<string, unknown>,
  id?: string | null,
) => Promise<unknown>;

const listSuppliersTyped = listSuppliers as (
  query: URLSearchParams,
  actor: unknown,
  onlyActive?: boolean,
  options?: Record<string, unknown>,
) => Promise<unknown[]>;

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    return ok({ suppliers: await listSuppliersTyped(new URL(request.url).searchParams, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取供应商失败");
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const body = await parseJsonBody(request);
    const supplier = await saveSupplierTyped(request, actor, body);
    return NextResponse.json({ success: true, supplier, message: "供应商已保存" }, { status: 201 });
  } catch (error: unknown) {
    return apiError(error, "保存供应商失败");
  }
}
