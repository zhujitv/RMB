import type { PermissionSnapshot, User } from "../../types";
import { canReadPermission, canWritePermission } from "../../utils";

export function domesticLogisticsPermissions(user: User, permissions?: PermissionSnapshot) {
  const editableRoles = ["管理员", "业务员", "物流供应商", "物流资料录入员"];
  const canWriteLogistics = canWritePermission(
    user, permissions, "domesticLogistics", editableRoles,
  );
  return {
    canDeleteDomesticLogistics: canWritePermission(user, permissions, "domesticLogistics", ["管理员"]),
    canArchiveDomesticLogistics: canWritePermission(user, permissions, "domesticLogistics", ["管理员"]),
    canEditDomesticLogistics: canWriteLogistics,
    canUploadCustomsDocuments: canWriteLogistics
      && canWritePermission(user, permissions, "documents", editableRoles),
    canDeleteCustomsDocuments: canWritePermission(user, permissions, "documents", ["管理员"]),
    canCreateLogisticsExpense: canWritePermission(user, permissions, "logistics", ["管理员", "物流供应商"]),
    canViewShipsgoControlTower: canReadPermission(user, permissions, "domesticLogistics", editableRoles),
    canManageShipsgoTracking: ["管理员", "业务员"].includes(user.role)
      && canWritePermission(user, permissions, "domesticLogistics", ["管理员", "业务员"]),
    canDeleteShipsgoTracking: user.role === "管理员"
      && canWritePermission(user, permissions, "domesticLogistics", ["管理员"]),
  };
}
