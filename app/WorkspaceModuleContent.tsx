"use client";

import type { Dispatch, SetStateAction } from "react";
import dynamic from "next/dynamic";
import { AccountSettings } from "./AccountSettings";
import { StatusPanel } from "./StatusPanel";
import styles from "./WorkspaceShell.module.css";
import type { AuthPayload, AuthState, CompanyProfileSettings, MenuItem, WorkbenchTodo, WorkbenchTodosState } from "./types";
import type { SettingsTabKey } from "./modules/settings/types";
import { canWritePermission } from "./utils";
import { WelcomePanel } from "./WelcomePanel";

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

type KeywordFocus = { keyword: string; token: number };
type TaxRefundFocus = { keyword: string; action: string; token: number };
type LogisticsFeesFocus = { keyword: string; billId: string; token: number };
type SupplierDocumentsFocus = { keyword: string; requestId: string; token: number };
type CustomerCommunicationFocus = { keyword: string; orderId: string; token: number };
type SettingsFocus = { tab: SettingsTabKey; token: number };

export function WorkspaceModuleContent({
  payload,
  menus,
  activeMenu,
  allowedMenuKeys,
  workbenchTodos,
  bootWarnings,
  ordersFocus,
  paymentsFocus,
  costsFocus,
  profitFocus,
  taxRefundFocus,
  domesticLogisticsFocus,
  customerCommunicationFocus,
  oceanControlTowerFocus,
  logisticsFeesFocus,
  supplierDocumentsFocus,
  settingsFocus,
  setAuth,
  setActiveMenu,
  setOrdersFocus,
  setPaymentsFocus,
  setCostsFocus,
  setProfitFocus,
  setTaxRefundFocus,
  setDomesticLogisticsFocus,
  setCustomerCommunicationFocus,
  setLogisticsFeesFocus,
  setSupplierDocumentsFocus,
  setSettingsFocus,
  selectWorkspaceMenu,
  loadWorkbenchTodos,
  openWorkbenchTodo,
  updateCurrentUser,
  updateCompanyProfile,
}: {
  payload: AuthPayload;
  menus: MenuItem[];
  activeMenu: string;
  allowedMenuKeys: Set<string>;
  workbenchTodos: WorkbenchTodosState;
  bootWarnings: string[];
  ordersFocus: KeywordFocus;
  paymentsFocus: KeywordFocus;
  costsFocus: KeywordFocus;
  profitFocus: KeywordFocus;
  taxRefundFocus: TaxRefundFocus;
  domesticLogisticsFocus: KeywordFocus;
  customerCommunicationFocus: CustomerCommunicationFocus;
  oceanControlTowerFocus: KeywordFocus;
  logisticsFeesFocus: LogisticsFeesFocus;
  supplierDocumentsFocus: SupplierDocumentsFocus;
  settingsFocus: SettingsFocus;
  setAuth: Dispatch<SetStateAction<AuthState>>;
  setActiveMenu: Dispatch<SetStateAction<string>>;
  setOrdersFocus: Dispatch<SetStateAction<KeywordFocus>>;
  setPaymentsFocus: Dispatch<SetStateAction<KeywordFocus>>;
  setCostsFocus: Dispatch<SetStateAction<KeywordFocus>>;
  setProfitFocus: Dispatch<SetStateAction<KeywordFocus>>;
  setTaxRefundFocus: Dispatch<SetStateAction<TaxRefundFocus>>;
  setDomesticLogisticsFocus: Dispatch<SetStateAction<KeywordFocus>>;
  setCustomerCommunicationFocus: Dispatch<SetStateAction<CustomerCommunicationFocus>>;
  setLogisticsFeesFocus: Dispatch<SetStateAction<LogisticsFeesFocus>>;
  setSupplierDocumentsFocus: Dispatch<SetStateAction<SupplierDocumentsFocus>>;
  setSettingsFocus: Dispatch<SetStateAction<SettingsFocus>>;
  selectWorkspaceMenu: (menuKey: string) => void;
  loadWorkbenchTodos: (options?: { refresh?: boolean }) => Promise<void>;
  openWorkbenchTodo: (todo: WorkbenchTodo) => void;
  updateCurrentUser: (user: AuthPayload["user"]) => void;
  updateCompanyProfile: (settings: CompanyProfileSettings) => void;
}) {
  if (activeMenu === "welcome") {
    return <WelcomePanel payload={payload} menus={menus} todosState={workbenchTodos} bootWarnings={bootWarnings} onSelectMenu={selectWorkspaceMenu} onRefreshTodos={() => void loadWorkbenchTodos({ refresh: true })} onOpenTodo={openWorkbenchTodo} />;
  }
  if (activeMenu === "account") {
    return <AccountSettings user={payload.user} companyProfile={payload.companyProfile} onProfileSaved={updateCurrentUser} onPasswordChanged={(message) => setAuth({ status: "guest", message })} />;
  }
  if (!allowedMenuKeys.has(activeMenu)) {
    return <StatusPanel title="无权限访问" message="当前账号没有该功能模块权限，请从左侧选择可用菜单。" actionLabel="返回工作台首页" onAction={() => setActiveMenu("welcome")} />;
  }
  if (activeMenu === "orders") {
    return (
      <OrdersModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={ordersFocus.keyword}
        initialOpenToken={ordersFocus.token}
        onOpenExchangeSettings={() => {
          setSettingsFocus({ tab: "exchangeRates", token: Date.now() });
          setActiveMenu("settings");
        }}
      />
    );
  }
  if (activeMenu === "dashboard") return <DashboardModule />;
  if (activeMenu === "payments") return <PaymentsModule currentUser={payload.user} initialKeyword={paymentsFocus.keyword} initialOpenToken={paymentsFocus.token} />;
  if (activeMenu === "costs") return <CostsModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={costsFocus.keyword} initialOpenToken={costsFocus.token} />;
  if (activeMenu === "domesticLogistics") {
    return (
      <DomesticLogisticsModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={domesticLogisticsFocus.keyword}
        initialOpenToken={domesticLogisticsFocus.token}
        onOpenLogisticsFees={(focus) => {
          setLogisticsFeesFocus({ keyword: focus.keyword?.trim() || "", billId: focus.billId?.trim() || "", token: Date.now() });
          setActiveMenu("logisticsFees");
        }}
      />
    );
  }
  if (activeMenu === "logisticsFees") {
    return <LogisticsFeesModule title="物流费用" focusBillId={logisticsFeesFocus.billId} focusKeyword={logisticsFeesFocus.keyword} focusToken={logisticsFeesFocus.token} currentUserRole={payload.user.role} currentUserSupplierId={payload.user.supplierId || ""} canCreateExpense={canWritePermission(payload.user, payload.permissions, "logistics", ["管理员", "物流供应商"])} onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })} />;
  }
  if (activeMenu === "customerCommunication") {
    return <CustomerCommunicationModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={customerCommunicationFocus.keyword} initialOrderId={customerCommunicationFocus.orderId} initialOpenToken={customerCommunicationFocus.token} />;
  }
  if (activeMenu === "oceanControlTower") {
    return <DomesticLogisticsModule currentUser={payload.user} permissions={payload.permissions} initialKeyword={oceanControlTowerFocus.keyword} initialOpenToken={oceanControlTowerFocus.token} initialView="controlTower" initialControlTowerFullscreen />;
  }
  if (activeMenu === "supplierDocuments") {
    return <SupplierDocumentsModule currentUser={payload.user} initialKeyword={supplierDocumentsFocus.keyword} initialRequestId={supplierDocumentsFocus.requestId} initialOpenToken={supplierDocumentsFocus.token} onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })} />;
  }
  if (activeMenu === "profit") return <ProfitModule currentUser={payload.user} initialKeyword={profitFocus.keyword} initialOpenToken={profitFocus.token} />;
  if (activeMenu === "taxRefund") {
    return (
      <TaxRefundModule
        currentUser={payload.user}
        permissions={payload.permissions}
        initialKeyword={taxRefundFocus.keyword}
        initialAction={taxRefundFocus.action}
        initialOpenToken={taxRefundFocus.token}
        onRefreshTodos={() => loadWorkbenchTodos({ refresh: true })}
        onOpenDomesticLogistics={(keyword) => {
          setDomesticLogisticsFocus({ keyword, token: Date.now() });
          setActiveMenu("domesticLogistics");
        }}
        onOpenSupplierDocuments={(keyword) => {
          setSupplierDocumentsFocus({ keyword: keyword.trim(), requestId: "", token: Date.now() });
          setActiveMenu("supplierDocuments");
        }}
      />
    );
  }
  if (activeMenu === "reports") {
    return (
      <ReportsModule
        currentUser={payload.user}
        permissions={payload.permissions}
        onOpenRecord={(targetMenu, keyword) => {
          const value = keyword.trim();
          if (targetMenu === "orders") setOrdersFocus({ keyword: value, token: Date.now() });
          else if (targetMenu === "payments") setPaymentsFocus({ keyword: value, token: Date.now() });
          else if (targetMenu === "costs") setCostsFocus({ keyword: value, token: Date.now() });
          else if (targetMenu === "profit") setProfitFocus({ keyword: value, token: Date.now() });
          else if (targetMenu === "taxRefund") setTaxRefundFocus({ keyword: value, action: "", token: Date.now() });
          setActiveMenu(targetMenu);
        }}
      />
    );
  }
  if (activeMenu === "settings") return <SettingsModule currentUser={payload.user} initialTab={settingsFocus.tab} initialTabToken={settingsFocus.token} onCompanyProfileSaved={updateCompanyProfile} />;
  if (activeMenu === "manual") return <ManualModule />;
  return <StatusPanel title="功能暂不可用" message="该功能入口暂未开放，请从左侧选择可用的业务模块。" actionLabel="返回工作台首页" onAction={() => setActiveMenu("welcome")} />;
}
