import type { NextRequest } from "next/server";
import { createSystemBackup, ok, readSystemBackupSettings } from "../../../../lib/platform-db";
import { withApiRead, withApiWrite } from "../../../../lib/api-route-guard";

export const dynamic = "force-dynamic";

export const GET = withApiRead("settings", async (_request, actor) => {
  return ok({ settings: await readSystemBackupSettings(actor) });
}, { errorMessage: "读取系统备份失败" });

export const POST = withApiWrite("settings", async (request: NextRequest, actor) => {
  const result = await createSystemBackup(request, actor);
  return ok({ success: true, message: "系统备份已生成", ...result });
}, { errorMessage: "生成系统备份失败" });
