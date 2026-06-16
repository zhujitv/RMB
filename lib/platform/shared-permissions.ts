import { assertWrite, type AccessUser } from "./shared-access";
import { ROLES } from "./shared-constants";
export {
  checkedPermissionList,
  customDataScopeFallback,
  CUSTOMER_VIEW_ALL_ROLES,
  DATA_SCOPES,
  effectivePermissions,
  MENU_KEYS,
  optionList,
  pageParams,
  pageResult,
  PERMISSION_MODES,
  permissionMode,
  permissionObject,
  READ_PERMISSIONS,
  READ_PERMISSION_KEYS,
  roleDataScope,
  roleMenus,
  rolePermissionSnapshot,
  roleReadKeys,
  roleScopeText,
  roleWriteKeys,
  ROLE_MENUS,
  ROLE_SCOPE_TEXT,
  SETTINGS_PERMISSION_LABELS,
  UNSAFE_METHODS,
  normalizedCustomPermissionInput,
  WRITE_PERMISSIONS,
  WRITE_PERMISSION_KEYS,
} from "./shared-permission-data";
import {
  MENU_KEYS,
  optionList,
  READ_PERMISSION_KEYS,
  roleReadKeys,
  roleWriteKeys,
  ROLE_MENUS,
  SETTINGS_PERMISSION_LABELS,
  WRITE_PERMISSION_KEYS,
} from "./shared-permission-data";

export function getPermissionConfig(actor: AccessUser) {
  assertWrite(actor, "users");
  return {
    roles: ROLES,
    permissionModes: [
      { value: "ROLE", label: "固定角色权限" },
      { value: "CUSTOM", label: "自定义组合权限" },
    ],
    dataScopeOptions: [
      { value: "ALL", label: "全部数据" },
      { value: "OWN", label: "本人客户和订单" },
      { value: "OWN_COST", label: "本人成本相关" },
      { value: "NONE", label: "无数据范围" },
    ],
    menuPermissionOptions: optionList(MENU_KEYS, SETTINGS_PERMISSION_LABELS.menu),
    readPermissionOptions: optionList(READ_PERMISSION_KEYS, SETTINGS_PERMISSION_LABELS.read),
    writePermissionOptions: optionList(WRITE_PERMISSION_KEYS, SETTINGS_PERMISSION_LABELS.write),
    roleMenus: ROLE_MENUS,
    roleReads: Object.fromEntries(ROLES.map((role) => [role, roleReadKeys(role)])),
    roleWrites: Object.fromEntries(ROLES.map((role) => [role, roleWriteKeys(role)])),
  };
}
