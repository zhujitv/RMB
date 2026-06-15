import type { PermissionSnapshot, User } from "./types";

type CustomerNameLike = {
  customerShortName?: string | null;
  customerName?: string | null;
  customerFullName?: string | null;
  shortName?: string | null;
  name?: string | null;
  fullName?: string | null;
};

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function initials(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "NW";
  return trimmed.slice(0, 1).toUpperCase();
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

export function customerDisplayName(record?: CustomerNameLike | null) {
  return record?.customerShortName
    || record?.shortName
    || record?.customerName
    || record?.name
    || record?.customerFullName
    || record?.fullName
    || "-";
}

export function customerLegalName(record?: CustomerNameLike | null) {
  return record?.customerFullName
    || record?.fullName
    || record?.customerName
    || record?.name
    || record?.customerShortName
    || record?.shortName
    || "-";
}
