import { NextResponse } from "next/server";
import {
  apiError,
  assertLoginNotRateLimited,
  createUserSession,
  ensureDefaultUsers,
  isInitialAdminPasswordLogin,
  isUnsafeDefaultAdminEmail,
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
    if (isUnsafeDefaultAdminEmail(email)) {
      await recordLoginAttempt(request, email, false, null);
      return NextResponse.json({ success: false, error: "默认管理员账号已禁用，请使用公司管理员账号登录。", message: "默认管理员账号已禁用，请使用公司管理员账号登录。" }, { status: 403 });
    }
    let user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user || !(await verifyPassword(body.password || "", user.passwordHash))) {
      await recordLoginAttempt(request, email, false, user?.id || null);
      return NextResponse.json({ success: false, error: "邮箱或密码错误", message: "邮箱或密码错误" }, { status: 401 });
    }
    const approvalStatus = user.approvalStatus || (user.isActive ? "APPROVED" : "DISABLED");
    if (approvalStatus === "PENDING") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ success: false, error: "账号待管理员审核", message: "账号待管理员审核" }, { status: 403 });
    }
    if (approvalStatus === "REJECTED") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ success: false, error: "账号审核未通过，请联系管理员。", message: "账号审核未通过，请联系管理员。" }, { status: 403 });
    }
    if (!user.isActive || approvalStatus === "DISABLED") {
      await recordLoginAttempt(request, email, false, user.id);
      return NextResponse.json({ success: false, error: "账号已停用", message: "账号已停用" }, { status: 403 });
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
    const safeUser = publicUser(user);
    const response = NextResponse.json({
      success: true,
      user: safeUser,
      mustChangePassword: Boolean(safeUser.mustChangePassword),
      message: Boolean(safeUser.mustChangePassword) ? "请先修改初始密码" : "登录成功",
    });
    setSessionCookie(response, session.token);
    return response;
  } catch (error) {
    if (error?.status) return apiError(error, "登录失败");
    console.error("登录服务异常", error);
    return NextResponse.json({
      success: false,
      error: "登录服务异常，请联系管理员查看部署日志。",
      message: "登录服务异常，请联系管理员查看部署日志。",
      code: error?.code || "LOGIN_SERVICE_ERROR",
    }, { status: 500 });
  }
}
