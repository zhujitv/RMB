import { customerDisplayName } from "../../utils";
import type { RiskOrder } from "./types";

export function barHeight(value: unknown, max: number) {
  return Math.max(6, (Number(value || 0) / Math.max(max, 1)) * 100);
}

export function monthLabel(value?: string) {
  const month = Number(String(value || "").slice(5, 7));
  return month ? `${month}月` : value || "-";
}

export function displayCustomer(row: RiskOrder) {
  return customerDisplayName(row);
}

export function sumBy<T>(rows: T[], getter: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
}
