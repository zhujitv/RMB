import { apiError, getActor, listSuppliers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const page = await listSuppliers(query, actor, false, { paginated: true });
    return ok({
      suppliers: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error) {
    return apiError(error, "读取供应商设置失败");
  }
}
