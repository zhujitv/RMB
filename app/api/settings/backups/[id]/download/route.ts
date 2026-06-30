import type { NextRequest } from "next/server";
import { readSystemBackupFile } from "../../../../../../lib/platform-db";
import { withApiRead } from "../../../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const GET = withApiRead<RouteContext>("settings", async (_request: NextRequest, actor, context) => {
  const { id } = await context.params;
  const { backup, body } = await readSystemBackupFile(actor, id);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backup.fileName}"; filename*=UTF-8''${encodeURIComponent(backup.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}, { errorMessage: "下载系统备份失败" });
