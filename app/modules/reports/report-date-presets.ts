export type ReportDatePreset = "month" | "previousMonth" | "quarter" | "year" | "all";

export function reportDatePreset(preset: ReportDatePreset) {
  if (preset === "all") return { dateFrom: "", dateTo: "" };
  const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = chinaNow.getUTCFullYear();
  const month = chinaNow.getUTCMonth();
  const day = chinaNow.getUTCDate();
  const dateText = (value: Date) => value.toISOString().slice(0, 10);
  const today = new Date(Date.UTC(year, month, day));
  if (preset === "year") return { dateFrom: `${year}-01-01`, dateTo: dateText(today) };
  if (preset === "quarter") {
    const quarterStart = Math.floor(month / 3) * 3;
    return { dateFrom: dateText(new Date(Date.UTC(year, quarterStart, 1))), dateTo: dateText(today) };
  }
  if (preset === "previousMonth") {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { dateFrom: dateText(start), dateTo: dateText(end) };
  }
  return { dateFrom: dateText(new Date(Date.UTC(year, month, 1))), dateTo: dateText(today) };
}
