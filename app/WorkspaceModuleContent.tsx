"use client";

import type { Dispatch, SetStateAction } from "react";
import dynamic from "next/dynamic";
import { AccountSettings } from "./AccountSettings";
import { StatusPanel } from "./StatusPanel";
import styles from "./WorkspaceShell.module.css";
import type { AuthPayload, AuthState, CompanyProfileSettings, MenuItem, WorkbenchTodo, WorkbenchTodosState } from "./types";
import { canWritePermission } from "./utils";
import { WelcomePanel } from "./WelcomePanel";
import type { WorkspaceTabFocus, WorkspaceTabFocusInput } from "./workspace/workspace-tabs";

function BusinessModuleLoading() {
  return (
    <section className={styles.moduleCard}>
      <div className={styles.emptyState}>正在加载模块...</div>
    </section>
  );
}

const OrdersModule = dynamic(() => import("./modules/OrdersModule").then((module) => module.OrdersModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const DashboardModule = dynamic(() => import("./modules/DashboardModule").then((module) => module.DashboardModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const PaymentsModule = dynamic(() => import("./modules/PaymentsModule").then((module) => module.PaymentsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const CostsModule = dynamic(() => import("./modules/CostsModule").then((module) => module.CostsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const DomesticLogisticsModule = dynamic(() => import("./modules/DomesticLogisticsModule").then((module) => module.DomesticLogisticsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const CustomerCommunicationModule = dynamic(() => import("./modules/CustomerCommunicationModule").then((module) => module.CustomerCommunicationModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const LogisticsFeesModule = dynamic(() => import("./modules/LogisticsFeesModule").then((module) => module.LogisticsFeesModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const SupplierDocumentsModule = dynamic(() => import("./modules/SupplierDocumentsModule").then((module) => module.SupplierDocumentsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const ProfitModule = dynamic(() => import("./modules/ProfitModule").then((module) => module.ProfitModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const TaxRefundModule = dynamic(() => import("./modules/TaxRefundModule").then((module) => module.TaxRefundModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const ReportsModule = dynamic(() => import("./modules/ReportsModule").then((module) => module.ReportsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const SettingsModule = dynamic(() => import("./modules/SettingsModule").then((module) => module.SettingsModule), { ssr: false, loading: () => <BusinessModuleLoading /> });
const ManualModule = dynamic(() => import("./modules/ManualModule").then((module) => module.ManualModule), { ssr: false, loading: () => <BusinessModuleLoading /> });

type OpenWorkspaceMenu = (
  menuKey: string,
  focus?: WorkspaceTabFocusInput,
  options?: { forceNew?: boolean; title?: string },
) => string;

export function WorkspaceModuleContent({
  payload,
  menus,
  activeMenu,
  allowedMenuKeys,
  workbenchTodos,
  bootWarnings,
  focus,
  setAuth,
  openWorkspaceMenu,
  loadWorkbenchTodos,
  openWorkbenchTodo,
  updateCurrentUser,
  updateCompanyProfile,
  confirmSessionEnd,
}: {
  payload: AuthPayload;
  menus: MenuItem[];
  activeMenu: string;
  allowedMenuKeys: Set<string>;
  workbenchTodos: WorkbenchTodosState;
  bootWarnings: string[];
  focus: WorkspaceTabFocus;
  setAuth: Dispatch<SetStateAction<AuthState>>;
  openWorkspaceMenu: OpenWorkspaceMenu;
  loadWorkbenchTodos: (options?: { refresh?: boolean }) => Promise<void>;
  openWorkbenchTodo: (todo: WorkbenchTodo) => void;
  updateCurrentUser: (user: AuthPayload["user"]) => void;
  updateCompanyProfile: (settings: CompanyProfileSettings) => void;
  confirmSessionEnd: (hasCurrentTabUnsavedChanges?: boolean) => boolean;
}) {
  if (activeMenu === "welcome") {
    return <WelcomePanel payload={payload} menus={menus} todosState={workbenchTodos} bootWarnings={bootWarnings} onSelectMenu={(menuKey) => openWorkspaceMenu(menuKey)} onRefreshTodos={() => void loadWorkbenchTodos({ refresh: true })} onOpenTodo={openWorkbenchTodo} />;
  }
  if (activeMenu === "account") {
    return <AccountSettings user={payload.user} companyProfile={payload.companyProfile} onProfileSaved={updateCurrentUser} onBeforePasswordChange={confirmSessionEnd} onPasswordChanged={(message) => setAuth({ status: "guest", message })} />;
  }
  if (!allowedMenuKeys.has(activeMenu)) {
    return <StatusPanel title="无权限访问" message="当前账号没有该功能模块权限，请从左侧选择可用菜单。" actionLabel="返回工作台首页" onAction={() => openWorkspaceMenu("welcome")} />;
  }
  if (activeMenu === "orders") {
    return (
      <OrdersModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={focus.keyword}
        initialOpenToken={focus.token}
        onOpenExchangeSettings={() => openWorkspaceMenu("settings", { settingsTab: "exchangeRates" })}
      />
    );
  }
  if (activeMenu === "dashboard") return <DashboardModule />;
  if (activeMenu === "payments") return <PaymentsModule currentUser={payload.user} initialKeyword={focus.keyword} initialOpenToken={focus.token} />;
  if (activeMenu === "costs") return <CostsModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={focus.keyword} initialOpenToken={focus.token} />;
  if (activeMenu === "domesticLogistics") {
    return (
      <DomesticLogisticsModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={focus.keyword}
        initialOpenToken={focus.token}
        onOpenLogisticsFees={(nextFocus) => openWorkspaceMenu("logisticsFees", {
          keyword: nextFocus.keyword?.trim() || "",
          billId: nextFocus.billId?.trim() || "",
        })}
      />
    );
  }
  if (activeMenu === "logisticsFees") {
    return <LogisticsFeesModule title="物流费用" focusBillId={focus.billId} focusKeyword={focus.keyword} focusToken={focus.token} currentUserRole={payload.user.role} currentUserSupplierId={payload.user.supplierId || ""} canCreateExpense={canWritePermission(payload.user, payload.permissions, "logistics", ["管理员", "物流供应商"])} onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })} />;
  }
  if (activeMenu === "customerCommunication") {
    return <CustomerCommunicationModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={focus.keyword} initialOrderId={focus.orderId} initialOpenToken={focus.token} />;
  }
  if (activeMenu === "oceanControlTower") {
    return <DomesticLogisticsModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={focus.keyword} initialOpenToken={focus.token} initialView="controlTower" initialControlTowerFullscreen />;
  }
  if (activeMenu === "supplierDocuments") {
    return <SupplierDocumentsModule currentUser={payload.user} initialKeyword={focus.keyword} initialRequestId={focus.requestId} initialOpenToken={focus.token} onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })} />;
  }
  if (activeMenu === "profit") return <ProfitModule currentUser={payload.user} initialKeyword={focus.keyword} initialOpenToken={focus.token} />;
  if (activeMenu === "taxRefund") {
    return (
      <TaxRefundModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={focus.keyword}
        initialAction={focus.action}
        initialOpenToken={focus.token}
        onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })}
        onOpenDomesticLogistics={(keyword) => openWorkspaceMenu("domesticLogistics", { keyword })}
        onOpenSupplierDocuments={(keyword) => openWorkspaceMenu("supplierDocuments", { keyword })}
      />
    );
  }
  if (activeMenu === "reports") {
    return (
      <ReportsModule
        currentUser={payload.user}
        permissions={payload.permissions}
        onOpenRecord={(targetMenu, keyword) => openWorkspaceMenu(targetMenu, { keyword: keyword.trim() })}
      />
    );
  }
  if (activeMenu === "settings") return <SettingsModule currentUser={payload.user} initialTab={focus.settingsTab || "home"} initialTabToken={focus.token} onCompanyProfileSaved={updateCompanyProfile} />;
  if (activeMenu === "manual") return <ManualModule />;
  return <StatusPanel title="功能暂不可用" message="该功能入口暂未开放，请从左侧选择可用的业务模块。" actionLabel="返回工作台首页" onAction={() => openWorkspaceMenu("welcome")} />;
}
