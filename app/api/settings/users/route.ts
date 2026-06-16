import type { NextRequest } from "next/server";
import { apiError, getActor, listUsers, ok } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

const listUsersTyped = listUsers as (
  actor: unknown,
  query: URLSearchParams | null,
  options?: { paginated?: boolean },
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
    const page = await listUsersTyped(actor, query, { paginated: true });
    return ok({
      users: page.rows,
      pagination: {
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
      },
    });
  } catch (error: unknown) {
    return apiError(error, "读取用户设置失败");
  }
}
