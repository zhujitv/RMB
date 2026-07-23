import { prisma } from "../prisma";
import { canRead, canWrite } from "./shared-access";
import { COMPANY_PROFILE_SETTING_KEY, effectivePermissions, getExchangeRateSettings, nonEmpty } from "./shared";
import type { ActorLike, TodoUser, WorkbenchTodoContext } from "./workbench-todos-types";
import { WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS, paymentVoucherReminderStartDateFromSettings } from "./workbench-todos-types";
import { actorId, taxRefundArchiveCompanyOwnerEntriesFromSetting, taxRefundArchiveOwnerIdsFromSetting, taxRefundArchiveOwnerUsersFromIds, systemCompanyKeysFromProfile } from "./workbench-todos-owners";

export function isTaxRefundExportInvoiceFinanceUser(user: TodoUser) {
  const permissions = effectivePermissions(user);
  const dataScope = permissions.dataScope;
  return user.role === "财务"
    && permissions.menus.includes("taxRefund")
    && ["ALL", "OWN"].includes(dataScope)
    && canRead(user, "orders")
    && canRead(user, "taxRefund")
    && canRead(user, "documents")
    && canWrite(user, "documents");
}

export async function createWorkbenchTodoContext(actor: ActorLike): Promise<WorkbenchTodoContext> {
  const [users, taxRefundFinanceOwnerSettings, exchangeRateSettings] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        approvalStatus: "APPROVED",
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        supplierId: true,
        customPermissions: true,
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    prisma.systemSetting.findMany({
      where: { key: { in: [...WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS, COMPANY_PROFILE_SETTING_KEY] } },
      select: { key: true, value: true },
      take: WORKBENCH_TAX_REFUND_FINANCE_OWNER_SETTING_KEYS.length + 1,
    }).catch(() => []),
    getExchangeRateSettings(),
  ]);
  const usersBySupplierId = new Map<string, TodoUser[]>();
  for (const user of users) {
    const supplierId = nonEmpty(user.supplierId);
    if (!supplierId) continue;
    const rows = usersBySupplierId.get(supplierId) || [];
    rows.push(user);
    usersBySupplierId.set(supplierId, rows);
  }
  const taxRefundArchiveFinanceUsers = users.filter((user) => user.role === "财务" && canWrite(user, "taxRefund"));
  const taxRefundExportInvoiceFinanceUsers = users.filter(isTaxRefundExportInvoiceFinanceUser);
  const taxRefundOwnerSettings = taxRefundFinanceOwnerSettings
    .filter((setting) => setting.key !== COMPANY_PROFILE_SETTING_KEY);
  const companyProfileSetting = taxRefundFinanceOwnerSettings
    .find((setting) => setting.key === COMPANY_PROFILE_SETTING_KEY);
  const configuredTaxRefundFinanceOwnerIds = taxRefundOwnerSettings
    .flatMap((setting) => taxRefundArchiveOwnerIdsFromSetting(setting.value));
  const taxRefundArchiveConfiguredOwnerUsers = taxRefundArchiveOwnerUsersFromIds(users, configuredTaxRefundFinanceOwnerIds);
  const taxRefundArchiveCompanyOwnerUsersByKey = new Map<string, TodoUser[]>();
  for (const entry of taxRefundOwnerSettings.flatMap((setting) => taxRefundArchiveCompanyOwnerEntriesFromSetting(setting.value))) {
    const ownerUsers = taxRefundArchiveOwnerUsersFromIds(users, entry.ownerIds);
    if (!ownerUsers.length) continue;
    for (const companyKey of entry.companyKeys) {
      const existing = taxRefundArchiveCompanyOwnerUsersByKey.get(companyKey) || [];
      for (const user of ownerUsers) {
        if (!existing.some((item) => item.id === user.id)) existing.push(user);
      }
      taxRefundArchiveCompanyOwnerUsersByKey.set(companyKey, existing);
    }
  }
  const systemCompanyKeys = systemCompanyKeysFromProfile(companyProfileSetting?.value);
  return {
    actor,
    actorUserId: actorId(actor),
    users,
    adminUserIds: users.filter((user) => user.role === "管理员").map((user) => user.id),
    financeUsers: users.filter((user) => user.role === "财务"),
    taxRefundExportInvoiceFinanceUsers,
    taxRefundArchiveFinanceUsers,
    taxRefundArchiveConfiguredOwnerUsers,
    taxRefundArchiveCompanyOwnerUsersByKey,
    systemCompanyKeys,
    purchaseUsers: users.filter((user) => user.role === "采购"),
    usersBySupplierId,
    paymentVoucherReminderStartDate: paymentVoucherReminderStartDateFromSettings(exchangeRateSettings),
  };
}
