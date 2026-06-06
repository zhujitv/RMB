import { NextResponse } from "next/server";
import {
  apiError,
  assertLoginNotRateLimited,
  createUserSession,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  normalizeEmail,
  passwordHashNeedsUpgrade,
  publicUser,
  recordLoginAttempt,
  setSessionCookie,
  upgradePasswordHash,
  verifyPassword,
} from "../../../../lib/platform-db";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await ensureDefaultUsers();
    const body = await request.json();
    const email = normalizeEmail(body.email);
    await assertLoginNotRateLimited(request, email);
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user || !verifyPassword(body.password || "", user.passwordHash)) {
      await recordLoginAttempt(request, email, false, user?.id || null);
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    const approvalStatus = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
    if (approvalStatus === "PENDING") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ error: "账号已提交注册，正在等待管理员审核。" }, { status: 403 });
    }
    if (approvalStatus === "REJECTED") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ error: "账号审核未通过，请联系管理员。" }, { status: 403 });
    }
    if (!user.isActive || approvalStatus === "DISABLED") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ error: "账号已停用，请联系管理员。" }, { status: 403 });
    }
    if (passwordHashNeedsUpgrade(user.passwordHash)) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradePasswordHash(body.password || "") },
      });
    }
    if (!user.mustChangePassword && isInitialAdminPasswordLogin(user, body.password || "")) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
      });
    }
    await recordLoginAttempt(request, email, true, user.id);
    const session = await createUserSession(request, user);
    const response = NextResponse.json({ user: publicUser(user) });
    setSessionCookie(response, session.token);
    return response;
  } catch (error) {
    return apiError(error, "登录失败");
  }
}
