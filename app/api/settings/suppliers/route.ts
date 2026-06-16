import type { NextRequest } from "next/server";
import { apiError, getActor, listSuppliers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

const listSuppliersPageTyped = listSuppliers as (
  query: URLSearchParams,
  actor: unknown,
  onlyActive: boolean,
  options: { paginated: true },
) => Promise<{
  rows: unknown[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;

export async function GET(request: NextRequest) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const page = await listSuppliersPageTyped(query, actor, false, { paginated: true });
    return ok({
      suppliers: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取供应商设置失败");
  }
}
