import { NextResponse } from "next/server";
import { apiError, ensureDefaultUsers, hashPassword, normalizeEmail, publicUser } from "../../../../lib/platform-db";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    await ensureDefaultUsers();
    const body = await request.json();
    const email = normalizeEmail(body.email);
    const passwordHash = hashPassword(body.password || "");
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, passwordHash, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
    }
    const response = NextResponse.json({ user: publicUser(user) });
    response.cookies.set("fta_user_id", user.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
    return response;
  } catch (error) {
    return apiError(error, "登录失败");
  }
}
