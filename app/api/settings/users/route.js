import { apiError, getActor, listUsers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const actor = await getActor(request);
    const query = new URL(request.url).searchParams;
    const page = await listUsers(actor, query, { paginated: true });
    return ok({
      users: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error) {
    return apiError(error, "读取用户设置失败");
  }
}
