import type { FormEvent } from "react";
import { apiJson } from "../../api";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../../lib/password-policy";
import { FACTORY_SUPPLIER_ACCOUNT_ROLES, PRODUCT_SUPPLIER_TYPES } from "./constants";
import {
  businessEntityFormFromRow,
  isSupplierAccountRole,
  supplierMatchesUserRole,
} from "./helpers";
import type { BusinessEntityRow, SupplierRow } from "./types";
import type { SettingsSaveActionsContext } from "./use-settings-save-actions";
export function useSettingsEntitySaveActions(context: SettingsSaveActionsContext) {
  const {
    activePagination,
    activeSuppliers,
    businessEntityForm,
    customerForm,
    filters,
    loadTab,
    markLoaded,
    setBusinessEntities,
    setBusinessEntityForm,
    setBusinessEntityMessage,
    setBusinessEntitySaving,
    setCustomerForm,
    setCustomerMessage,
    setCustomerSaving,
    setSelectedUserId,
    setSupplierForm,
    setSupplierMessage,
    setSupplierPanelMode,
    setSupplierSaving,
    setSuppliers,
    setUserForm,
    setUserMessage,
    setUserSaving,
    supplierForm,
    suppliers,
    userForm,
  } = context;

async function saveCustomerForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerForm) return;
    if (!customerForm.name.trim()) {
      setCustomerMessage("请填写客户全称");
      return;
    }
    setCustomerSaving(true);
    setCustomerMessage("");
    try {
      const isEdit = Boolean(customerForm.id);
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/customers/${encodeURIComponent(customerForm.id)}` : "/api/customers",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            name: customerForm.name,
            shortName: customerForm.shortName,
            country: customerForm.country,
            defaultCurrency: customerForm.defaultCurrency || undefined,
            salespersonUserId: customerForm.salespersonUserId || undefined,
            commissionRate: Number(customerForm.commissionRate || 0),
            commissionStatus: customerForm.commissionStatus,
            contactPerson: customerForm.contactPerson,
            contactEmail: customerForm.contactEmail,
            contactPhone: customerForm.contactPhone,
            enableAutoShippingDocsNotification: customerForm.enableAutoShippingDocsNotification,
            shippingDocsEmails: customerForm.shippingDocsEmails,
            shippingDocsCcEmails: customerForm.shippingDocsCcEmails,
            autoSendDocumentTypes: customerForm.autoSendDocumentTypes,
            clearanceEmailLanguage: customerForm.clearanceEmailLanguage,
            remark: customerForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "客户资料保存失败");
      setCustomerForm(null);
      await loadTab("customers", activePagination.page || 1, filters.customers);
    } catch (saveError) {
      setCustomerMessage(saveError instanceof Error ? saveError.message : "客户资料保存失败");
    } finally {
      setCustomerSaving(false);
    }
  }
async function saveSupplierForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierForm) return;
    if (!supplierForm.supplierName.trim()) {
      setSupplierMessage("请填写供应商名称");
      return;
    }
    if (PRODUCT_SUPPLIER_TYPES.includes(supplierForm.supplierType) && supplierForm.dispatchSmsEnabled && !supplierForm.dispatchSmsPhone.trim()) {
      setSupplierMessage("启用采购短信通知后，请填写采购通知手机号");
      return;
    }
    if (PRODUCT_SUPPLIER_TYPES.includes(supplierForm.supplierType)
      && !/^(?:0(?:\.\d{1,4})?|[1-4](?:\.\d{1,4})?|5(?:\.0{1,4})?)$/.test(supplierForm.purchaseQuantityTolerancePercent.trim())) {
      setSupplierMessage("交付数量公差必须在 0% 到 5% 之间，最多保留 4 位小数");
      return;
    }
    setSupplierSaving(true);
    setSupplierMessage("");
    try {
      const isEdit = Boolean(supplierForm.id);
      const result = await apiJson<{ success?: boolean; message?: string; supplier?: SupplierRow }>(
        isEdit ? `/api/suppliers/${encodeURIComponent(supplierForm.id)}` : "/api/suppliers",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            supplierName: supplierForm.supplierName,
            supplierType: supplierForm.supplierType,
            status: supplierForm.status,
            country: supplierForm.country,
            contactPerson: supplierForm.contactPerson,
            phone: supplierForm.phone,
            email: supplierForm.email,
            address: supplierForm.address,
            invoiceTitle: supplierForm.invoiceTitle,
            taxNumber: supplierForm.taxNumber,
            bankName: supplierForm.bankName,
            bankAccount: supplierForm.bankAccount,
            purchasePaymentTerm: supplierForm.purchasePaymentTerm,
            purchasePrepaymentPercent: supplierForm.purchasePrepaymentPercent,
            purchaseQuantityTolerancePercent: PRODUCT_SUPPLIER_TYPES.includes(supplierForm.supplierType)
              ? supplierForm.purchaseQuantityTolerancePercent
              : "0",
            purchasePrepaymentRequiredBeforeProduction: supplierForm.purchasePrepaymentRequiredBeforeProduction,
            dispatchSmsEnabled: supplierForm.dispatchSmsEnabled,
            dispatchSmsPhone: supplierForm.dispatchSmsPhone,
            allowDomesticLogisticsEntry: supplierForm.allowDomesticLogisticsEntry,
            allowLogisticsExpenseEntry: supplierForm.allowLogisticsExpenseEntry,
            allowLogisticsInvoiceUpload: supplierForm.allowLogisticsInvoiceUpload,
            allowFactoryDocumentUpload: supplierForm.allowFactoryDocumentUpload,
            isDefaultLogisticsSupplier: supplierForm.isDefaultLogisticsSupplier,
            allowedLogisticsCostTypes: supplierForm.allowedLogisticsCostTypes,
            remark: supplierForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "供应商资料保存失败");
      const savedSupplier = result.supplier;
      if (savedSupplier?.id) {
        setSuppliers((current) => {
          const exists = current.some((supplier) => supplier.id === savedSupplier.id);
          return exists
            ? current.map((supplier) => (supplier.id === savedSupplier.id ? savedSupplier : supplier))
            : [savedSupplier, ...current];
        });
      }
      setSupplierPanelMode("view");
      setSupplierForm(null);
      setSupplierMessage(result.message || "供应商已保存");
      await loadTab("suppliers", activePagination.page || 1, filters.suppliers);
    } catch (saveError) {
      setSupplierMessage(saveError instanceof Error ? saveError.message : "供应商资料保存失败");
    } finally {
      setSupplierSaving(false);
    }
  }
async function saveBusinessEntityForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessEntityForm) return;
    if (!businessEntityForm.name.trim()) {
      setBusinessEntityMessage("请填写公司全称");
      return;
    }
    setBusinessEntitySaving(true);
    setBusinessEntityMessage("");
    try {
      const isEdit = Boolean(businessEntityForm.id);
      const result = await apiJson<{ success?: boolean; message?: string; entity?: BusinessEntityRow }>(
        "/api/settings/business-entities",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify({
            id: businessEntityForm.id || undefined,
            name: businessEntityForm.name,
            shortName: businessEntityForm.shortName,
            nameEn: businessEntityForm.nameEn,
            taxNumber: businessEntityForm.taxNumber,
            address: businessEntityForm.address,
            contactEmail: businessEntityForm.contactEmail,
            contactPhone: businessEntityForm.contactPhone,
            website: businessEntityForm.website,
            showContactPhoneOnPi: businessEntityForm.showContactPhoneOnPi,
            showContactEmailOnPi: businessEntityForm.showContactEmailOnPi,
            showWebsiteOnPi: businessEntityForm.showWebsiteOnPi,
            bankAccounts: businessEntityForm.bankAccounts,
            isDefault: businessEntityForm.isDefault,
            status: businessEntityForm.status,
            sortOrder: Number(businessEntityForm.sortOrder || 0),
            remark: businessEntityForm.remark,
          }),
        },
      );
      if (result.success !== true) throw new Error(result.message || "业务主体保存失败");
      const savedEntity = result.entity;
      if (savedEntity?.id) {
        setBusinessEntities((current) => {
          const withoutSaved = current.filter((entity) => entity.id !== savedEntity.id);
          const normalized = savedEntity.isDefault
            ? withoutSaved.map((entity) => ({ ...entity, isDefault: false }))
            : withoutSaved;
          return [savedEntity, ...normalized].sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
          });
        });
        setBusinessEntityForm(businessEntityFormFromRow(savedEntity));
      }
      setBusinessEntityMessage(result.message || "业务主体已保存");
      markLoaded("businessEntities");
    } catch (saveError) {
      setBusinessEntityMessage(saveError instanceof Error ? saveError.message : "业务主体保存失败");
    } finally {
      setBusinessEntitySaving(false);
    }
  }

async function saveUserForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userForm) return;
    if (!userForm.name.trim()) {
      setUserMessage("请填写姓名");
      return;
    }
    if (!userForm.email.trim()) {
      setUserMessage("请填写邮箱");
      return;
    }
    if (!userForm.id && !userForm.password.trim()) {
      setUserMessage("新建用户必须设置初始密码");
      return;
    }
    if (isSupplierAccountRole(userForm.role) && !userForm.supplierId) {
      setUserMessage(`${userForm.role}必须绑定供应商`);
      return;
    }
    if (isSupplierAccountRole(userForm.role)) {
      const supplier = activeSuppliers.find((item) => item.id === userForm.supplierId)
        || suppliers.find((item) => item.id === userForm.supplierId);
      if (!supplierMatchesUserRole(supplier, userForm.role)) {
        setUserMessage(FACTORY_SUPPLIER_ACCOUNT_ROLES.includes(userForm.role)
          ? "当前角色只能绑定产品供应商"
          : "当前角色只能绑定物流供应商");
        return;
      }
    }
    if (userForm.password.trim() && !passwordMeetsPolicy(userForm.password.trim())) {
      setUserMessage(PASSWORD_POLICY_MESSAGE);
      return;
    }
    setUserSaving(true);
    setUserMessage("");
    try {
      const isEdit = Boolean(userForm.id);
      const payload: Record<string, unknown> = {
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
        approvalStatus: userForm.approvalStatus,
        supplierId: isSupplierAccountRole(userForm.role) ? userForm.supplierId : "",
        customPermissions: userForm.permissionMode === "CUSTOM"
          ? {
            mode: "CUSTOM",
            menus: userForm.menus,
            reads: userForm.reads,
            writes: userForm.writes,
            dataScope: userForm.dataScope,
          }
          : { mode: "ROLE" },
      };
      if (isEdit) payload.expectedUpdatedAt = userForm.expectedUpdatedAt;
      if (userForm.password.trim()) payload.password = userForm.password.trim();
      const result = await apiJson<{ success?: boolean; message?: string }>(
        isEdit ? `/api/users/${encodeURIComponent(userForm.id)}` : "/api/users",
        {
          method: isEdit ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      if (result.success !== true) throw new Error(result.message || "用户保存失败");
      setUserForm(null);
      setSelectedUserId("");
      await loadTab("users", activePagination.page || 1, filters.users);
    } catch (saveError) {
      setUserMessage(saveError instanceof Error ? saveError.message : "用户保存失败");
    } finally {
      setUserSaving(false);
    }
  }

  return {
    saveCustomerForm,
    saveBusinessEntityForm,
    saveSupplierForm,
    saveUserForm,
  };
}
