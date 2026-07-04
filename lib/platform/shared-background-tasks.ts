import { recordBackgroundTaskMetric } from "./background-task-metrics";
import { logServerError, sanitizeForLog } from "./shared-base-utils";

type NonCriticalTaskOptions = {
  context?: Record<string, unknown>;
  slowMs?: number;
  track?: boolean;
};

function nonCriticalTaskSlowThresholdMs(value: unknown) {
  const configured = Number.parseInt(String(value || process.env.BACKGROUND_TASK_SLOW_MS || ""), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 1000;
}

export async function runNonCriticalTask<T>(
  label: string,
  task: () => T | Promise<T>,
  options: NonCriticalTaskOptions = {},
): Promise<T | null> {
  const startedAt = Date.now();
  let success = false;
  try {
    const result = await task();
    success = true;
    return result;
  } catch (error) {
    logServerError(`${label}失败`, error, options.context || {});
    return null;
  } finally {
    const durationMs = Date.now() - startedAt;
    if (options.track !== false) {
      recordBackgroundTaskMetric({ label, durationMs, success });
    }
    const slowMs = nonCriticalTaskSlowThresholdMs(options.slowMs);
    if (durationMs >= slowMs) {
      console.warn("background-task-slow-log", sanitizeForLog({
        task: label,
        durationMs,
        slowMs,
        success,
        ...(options.context || {}),
      }));
    }
  }
}
