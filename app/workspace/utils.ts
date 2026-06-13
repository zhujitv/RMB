export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function initials(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "NW";
  const ascii = trimmed.match(/[A-Za-z0-9]/g)?.slice(0, 2).join("");
  return (ascii || trimmed.slice(0, 2)).toUpperCase();
}
