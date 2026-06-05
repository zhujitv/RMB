import { apiError, getActor, ok, saveUser, writeAudit } from "../../../../lib/platform-db";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    const body = await request.json();
    return ok({ user: await saveUser(request, actor, body, id) });
  } catch (error) {
    return apiError(error, "更新用户失败");
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const actor = await getActor(request);
    if (actor.role !== "管理员") {
      const error = new Error("没有权限执行该操作");
      error.status = 403;
      throw error;
    }
    const before = await prisma.user.findUnique({ where: { id } });
    const user = await prisma.user.update({ where: { id }, data: { isActive: false } });
    await writeAudit(request, actor, "停用用户", "users", id, before, user);
    return ok({ ok: true });
  } catch (error) {
    return apiError(error, "停用用户失败");
  }
}
