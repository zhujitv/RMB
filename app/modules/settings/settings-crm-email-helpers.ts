import { DEFAULT_CRM_EMAIL_INTEGRATION_FORM } from "./constants";
import type { CrmEmailIntegrationForm, CrmEmailIntegrationSettings } from "./types";
import { stringSetting } from "./settings-config-helpers";

export function crmEmailIntegrationFormFromSettings(settings: CrmEmailIntegrationSettings | null): CrmEmailIntegrationForm {
  return {
    enabled: settings?.enabled === true,
    mailDomain: stringSetting(settings, "mailDomain", DEFAULT_CRM_EMAIL_INTEGRATION_FORM.mailDomain),
    outboundEnabled: settings?.outboundEnabled === true,
    inboundEnabled: settings?.inboundEnabled === true,
    outboundProvider: "RESEND",
  };
}

export function crmEmailIntegrationEnableValidationMessage(form: CrmEmailIntegrationForm) {
  if (!form.enabled) return "";
  if (!form.mailDomain.trim()) return "启用 CRM 邮件前，请填写系统邮箱域名";
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(form.mailDomain.trim())) {
    return "系统邮箱域名格式错误，例如 crm.nextwood.net";
  }
  return "";
}
