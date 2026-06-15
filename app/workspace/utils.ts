import type { PermissionSnapshot, User } from "./types";

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function initials(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "NW";
  const ascii = trimmed.match(/[A-Za-z0-9]/g)?.slice(0, 2).join("");
  return (ascii || trimmed.slice(0, 2)).toUpperCase();
}

export function canWritePermission(
  user: User,
  permissions: PermissionSnapshot | undefined,
  area: string,
  fallbackRoles: string[] = [],
) {
  if (user.role === "管理员") return true;
  if (permissions?.writes && Object.prototype.hasOwnProperty.call(permissions.writes, area)) {
    return Boolean(permissions.writes[area]);
  }
  if (Array.isArray(permissions?.writeKeys) && permissions.writeKeys.length) {
    return permissions.writeKeys.includes(area);
  }
  return fallbackRoles.includes(user.role);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function isPdfFile(file: File) {
  return file.name.toLowerCase().endsWith(".pdf") && file.type === "application/pdf";
}
