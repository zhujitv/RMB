import { apiError, getActor, listCustomerSalespeople, listCustomers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const [page, salespeople] = await Promise.all([
      listCustomers(query, actor, { paginated: true }),
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
  } catch (error) {
    return apiError(error, "读取客户设置失败");
  }
}
