"use client";

import { useEffect, useMemo, useState } from "react";
import { availableMenus } from "./menu";
import { LoadingPanel } from "./LoadingPanel";
import { LoginPanel } from "./LoginPanel";
import { PasswordChangePanel } from "./PasswordChangePanel";
import type { WorkbenchTodo } from "./types";
import type { SettingsTabKey } from "./modules/settings/types";
import { WorkspaceLayout } from "./WorkspaceLayout";
import { WorkspaceModuleContent } from "./WorkspaceModuleContent";
import {
  ALWAYS_ALLOWED_MENUS,
  normalizeWorkspaceMenuKey,
} from "./workspace-auth-helpers";
import { useWorkspaceAuthController } from "./workspace/use-workspace-auth-controller";

export function WorkspaceShell() {
  const [activeMenu, setActiveMenu] = useState("welcome");
  const [ordersFocus, setOrdersFocus] = useState({ keyword: "", token: 0 });
  const [paymentsFocus, setPaymentsFocus] = useState({ keyword: "", token: 0 });
  const [costsFocus, setCostsFocus] = useState({ keyword: "", token: 0 });
  const [profitFocus, setProfitFocus] = useState({ keyword: "", token: 0 });
  const [taxRefundFocus, setTaxRefundFocus] = useState({ keyword: "", action: "", token: 0 });
  const [domesticLogisticsFocus, setDomesticLogisticsFocus] = useState({ keyword: "", token: 0 });
  const [customerCommunicationFocus, setCustomerCommunicationFocus] = useState({ keyword: "", orderId: "", token: 0 });
  const [oceanControlTowerFocus, setOceanControlTowerFocus] = useState({ keyword: "", token: 0 });
  const [logisticsFeesFocus, setLogisticsFeesFocus] = useState({ keyword: "", billId: "", token: 0 });
  const [supplierDocumentsFocus, setSupplierDocumentsFocus] = useState({ keyword: "", requestId: "", token: 0 });
  const [settingsFocus, setSettingsFocus] = useState<{ tab: SettingsTabKey; token: number }>({ tab: "home", token: 0 });
  const workspaceAuth = useWorkspaceAuthController({ setActiveMenu });
  const {
    auth,
    bootWarnings,
    loginBusy,
    registerBusy,
    registerOpen,
    registerMessage,
    passwordBusy,
    publicCompanyProfile,
    workbenchTodos,
    setAuth,
    setRegisterOpen,
    handleLogin,
    handleRegister,
    handleChangePassword,
    handleLogout,
    loadWorkbenchTodos,
    updateCurrentUser,
    updateCompanyProfile,
  } = workspaceAuth;
  const payload = auth.status === "ready" ? auth.payload : null;
  const activeCompanyProfile = payload?.companyProfile || publicCompanyProfile;
  const menus = useMemo(() => payload ? availableMenus(payload.user, payload.permissions) : [], [payload]);
  const allowedMenuKeys = useMemo(() => new Set([...ALWAYS_ALLOWED_MENUS, ...menus.map((item) => item.key)]), [menus]);

  function selectWorkspaceMenu(menuKey: string) {
    const normalizedMenuKey = normalizeWorkspaceMenuKey(menuKey);
    if (menuKey === "logisticsReview") setLogisticsFeesFocus({ keyword: "", billId: "", token: Date.now() });
    if (normalizedMenuKey === "settings") setSettingsFocus({ tab: "home", token: Date.now() });
    setActiveMenu(normalizedMenuKey);
  }

  useEffect(() => {
    if (auth.status !== "ready") return;
    if (activeMenu === "logisticsReview") {
      setLogisticsFeesFocus({ keyword: "", billId: "", token: Date.now() });
      setActiveMenu("logisticsFees");
      return;
    }
    if (!allowedMenuKeys.has(activeMenu)) setActiveMenu("welcome");
  }, [activeMenu, allowedMenuKeys, auth.status]);

  useEffect(() => {
    document.title = activeCompanyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  }, [activeCompanyProfile?.systemName]);

  function openWorkbenchTodo(todo: WorkbenchTodo) {
    const href = todo.action?.href || "";
    const parsed = new URL(href || "/", "https://workspace.local");
    const path = parsed.pathname.replace(/^\/+/, "");
    const keyword = parsed.searchParams.get("keyword") || todo.orderNo || "";
    const token = Date.now();
    if (path === "orders") {
      setOrdersFocus({ keyword, token });
      setActiveMenu("orders");
      return;
    }
    if (path === "payments") {
      setPaymentsFocus({ keyword, token });
      setActiveMenu("payments");
      return;
    }
    if (path === "costs") {
      setCostsFocus({ keyword, token });
      setActiveMenu("costs");
      return;
    }
    if (path === "profit") {
      setProfitFocus({ keyword, token });
      setActiveMenu("profit");
      return;
    }
    if (path === "domestic-logistics") {
      setDomesticLogisticsFocus({ keyword, token });
      setActiveMenu("domesticLogistics");
      return;
    }
    if (path === "customer-communication") {
      setCustomerCommunicationFocus({
        keyword,
        orderId: parsed.searchParams.get("orderId") || "",
        token,
      });
      setActiveMenu("customerCommunication");
      return;
    }
    if (path === "ocean-control-tower") {
      setOceanControlTowerFocus({ keyword, token });
      setActiveMenu("oceanControlTower");
      return;
    }
    if (path === "logistics-fees") {
      setLogisticsFeesFocus({
        keyword,
        billId: parsed.searchParams.get("billId") || "",
        token,
      });
      setActiveMenu("logisticsFees");
      return;
    }
    if (path === "supplier-documents") {
      setSupplierDocumentsFocus({
        keyword,
        requestId: parsed.searchParams.get("requestId") || "",
        token,
      });
      setActiveMenu("supplierDocuments");
      return;
    }
    if (path === "tax-refund") {
      setTaxRefundFocus({ keyword, action: parsed.searchParams.get("action") || "", token });
      setActiveMenu("taxRefund");
    }
  }

  if (auth.status === "loading") return <LoadingPanel message={auth.message} />;

  if (auth.status === "guest") {
    return (
      <LoginPanel
        message={auth.message}
        companyProfile={publicCompanyProfile}
        loginBusy={loginBusy}
        registerBusy={registerBusy}
        registerOpen={registerOpen}
        registerMessage={registerMessage}
        onRegisterToggle={setRegisterOpen}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    );
  }

  if (auth.status === "password-change") {
    return (
      <PasswordChangePanel
        user={auth.user}
        message={auth.message}
        busy={passwordBusy}
        onSubmit={handleChangePassword}
        onLogout={handleLogout}
      />
    );
  }

  if (!payload) return <LoadingPanel message="正在加载工作台..." />;

  return (
    <WorkspaceLayout
      payload={payload}
      menus={menus}
      activeMenu={activeMenu}
      onSelectMenu={selectWorkspaceMenu}
      onLogout={handleLogout}
      onPasswordChange={(user) => setAuth({ status: "password-change", user })}
      workbenchTodos={workbenchTodos}
      onRefreshTodos={() => void loadWorkbenchTodos({ refresh: true })}
      onOpenTodo={openWorkbenchTodo}
    >
      <WorkspaceModuleContent
        payload={payload}
        menus={menus}
        activeMenu={activeMenu}
        allowedMenuKeys={allowedMenuKeys}
        workbenchTodos={workbenchTodos}
        bootWarnings={bootWarnings}
        ordersFocus={ordersFocus}
        paymentsFocus={paymentsFocus}
        costsFocus={costsFocus}
        profitFocus={profitFocus}
        taxRefundFocus={taxRefundFocus}
        domesticLogisticsFocus={domesticLogisticsFocus}
        customerCommunicationFocus={customerCommunicationFocus}
        oceanControlTowerFocus={oceanControlTowerFocus}
        logisticsFeesFocus={logisticsFeesFocus}
        supplierDocumentsFocus={supplierDocumentsFocus}
        settingsFocus={settingsFocus}
        setAuth={setAuth}
        setActiveMenu={setActiveMenu}
        setOrdersFocus={setOrdersFocus}
        setPaymentsFocus={setPaymentsFocus}
        setCostsFocus={setCostsFocus}
        setProfitFocus={setProfitFocus}
        setTaxRefundFocus={setTaxRefundFocus}
        setDomesticLogisticsFocus={setDomesticLogisticsFocus}
        setCustomerCommunicationFocus={setCustomerCommunicationFocus}
        setLogisticsFeesFocus={setLogisticsFeesFocus}
        setSupplierDocumentsFocus={setSupplierDocumentsFocus}
        setSettingsFocus={setSettingsFocus}
        selectWorkspaceMenu={selectWorkspaceMenu}
        loadWorkbenchTodos={loadWorkbenchTodos}
        openWorkbenchTodo={openWorkbenchTodo}
        updateCurrentUser={updateCurrentUser}
        updateCompanyProfile={updateCompanyProfile}
      />
    </WorkspaceLayout>
  );
}
