
export function csvCell(value: string) {
  const escaped = value.replaceAll('"', '""');
  const safe = /^[=+\-@]/.test(escaped) ? `'${escaped}` : escaped;
  return `"${safe}"`;
}
