import { type NextRequest } from "next/server";
import { apiError, verifyRegistrationEmail } from "../../../../lib/platform-db";

export const dynamic = "force-dynamic";

function htmlPage(title: string, message: string, ok = true) {
  const escapedTitle = title.replace(/[<>&"]/g, "");
  const escapedMessage = message.replace(/[<>&"]/g, "");
  return new Response(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #111827; }
      main { width: min(520px, calc(100vw - 32px)); padding: 32px; border: 1px solid #dbeafe; border-radius: 18px; background: #fff; box-shadow: 0 18px 45px rgba(15, 23, 42, .08); }
      h1 { margin: 0 0 12px; font-size: 22px; color: ${ok ? "#1d4ed8" : "#b91c1c"}; }
      p { margin: 0 0 22px; line-height: 1.7; color: #475569; }
      a { display: inline-flex; height: 40px; align-items: center; padding: 0 16px; border-radius: 10px; background: #2563eb; color: #fff; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>${escapedMessage}</p>
      <a href="/">返回登录页</a>
    </main>
  </body>
</html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
    status: ok ? 200 : 400,
  });
}

export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get("token") || "";
    await verifyRegistrationEmail(token, request);
    return htmlPage("邮箱验证成功", "邮箱已完成验证。管理员审核通过后，您即可登录 NEXTWOOD 供应链协同平台。");
  } catch (error: unknown) {
    const response = apiError(error, "邮箱验证失败");
    const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
    return htmlPage("邮箱验证失败", data.message || data.error || "邮箱验证链接无效或已过期。", false);
  }
}
