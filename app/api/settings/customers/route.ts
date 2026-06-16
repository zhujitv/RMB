import type { NextRequest } from "next/server";
import { apiError, getActor, listCustomerSalespeople, listCustomers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

const listCustomersPageTyped = listCustomers as (
  query: URLSearchParams,
  actor: unknown,
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
    const [page, salespeople] = await Promise.all([
      listCustomersPageTyped(query, actor, { paginated: true }),
      listCustomerSalespeople(actor),
    ]);
    return ok({
      customers: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
      salespeople,
    });
  } catch (error: unknown) {
    return apiError(error, "读取客户设置失败");
  }
}
