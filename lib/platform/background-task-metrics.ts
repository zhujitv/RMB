import { logServerError, nonEmpty } from "./shared-base-utils";

type BackgroundTaskMetricInput = {
  label: string;
  durationMs: number;
  success: boolean;
};

const BACKGROUND_TASK_PATH_LIMIT = 240;

export function backgroundTaskMetricPath(label: string) {
  const name = nonEmpty(label) || "未命名后台任务";
  return `/background/${name}`.slice(0, BACKGROUND_TASK_PATH_LIMIT);
}

export function recordBackgroundTaskMetric(input: BackgroundTaskMetricInput) {
  const label = nonEmpty(input.label);
  const durationMs = Math.max(0, Math.round(Number(input.durationMs || 0)));
  if (!label || !Number.isFinite(durationMs)) return;

  void (async () => {
    const { prisma } = await import("../prisma");
    await prisma.apiPerformanceLog.create({
      data: {
        source: "background",
        method: "TASK",
        path: backgroundTaskMetricPath(label),
        statusCode: input.success ? 200 : 500,
        durationMs,
        userId: null,
        role: null,
      },
    });
  })().catch((error) => {
    logServerError("后台任务耗时日志写入失败", error, { task: label });
  });
}
