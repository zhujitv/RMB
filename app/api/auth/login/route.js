import { NextResponse } from "next/server";
import {
  apiError,
  assertLoginNotRateLimited,
  createUserSession,
  ensureDefaultUsers,
  normalizeEmail,
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
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
    });
    if (!user || !verifyPassword(body.password || "", user.passwordHash)) {
      await recordLoginAttempt(request, email, false, user?.id || null);
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    if (/^[a-f0-9]{64}$/i.test(String(user.passwordHash || ""))) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: upgradePasswordHash(body.password || "") },
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
