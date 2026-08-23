import { startOfChinaDay } from "./workbench-todo-rules";

const DAY = 86_400_000;

export function chinaDaysBetween(left: Date | string, right: Date | string) {
  return Math.round((startOfChinaDay(new Date(left)).getTime() - startOfChinaDay(new Date(right)).getTime()) / DAY);
}

export function supplierPerformanceScore(input: {
  deliveredCount: number;
  onTimeRate: number | null;
  progressFreshness: number;
  responseRate: number;
  varianceRate: number;
}) {
  if (input.deliveredCount === 0 || input.onTimeRate === null) return null;
  return Math.max(0, Math.round(
    input.onTimeRate * .45
    + input.progressFreshness * .25
    + input.responseRate * .15
    + (100 - input.varianceRate) * .15,
  ));
}
