import type { FormEvent } from "react";
import { apiJson } from "../../api";
import { crmEmailIntegrationEnableValidationMessage, crmEmailIntegrationFormFromSettings } from "./settings-crm-email-helpers";
import type { CrmEmailIntegrationSettings } from "./types";
import type { SettingsSaveActionsContext } from "./use-settings-save-actions";

export function createSaveCrmEmailIntegrationSettings(context: SettingsSaveActionsContext) {
  return async function saveCrmEmailIntegrationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context.crmEmailIntegrationForm) return;
    const validationMessage = crmEmailIntegrationEnableValidationMessage(context.crmEmailIntegrationForm);
    if (validationMessage) {
      context.setCrmEmailIntegrationMessage(validationMessage);
      return;
    }
    context.setCrmEmailIntegrationSaving(true);
    context.setCrmEmailIntegrationMessage("");
    try {
      const result = await apiJson<{ success?: boolean; settings?: CrmEmailIntegrationSettings; message?: string }>(
        "/api/settings/crm-email",
        {
          method: "PATCH",
          body: JSON.stringify(context.crmEmailIntegrationForm),
        },
      );
      if (result.success !== true) throw new Error(result.message || "CRM邮件设置保存失败");
      const nextSettings = result.settings || context.crmEmailIntegrationForm;
      context.setCrmEmailIntegrationSettings(nextSettings);
      context.setCrmEmailIntegrationForm(crmEmailIntegrationFormFromSettings(nextSettings));
      context.markLoaded("crmEmailIntegration");
      context.setCrmEmailIntegrationMessage(result.message || "CRM邮件设置已保存");
    } catch (saveError) {
      context.setCrmEmailIntegrationMessage(saveError instanceof Error ? saveError.message : "CRM邮件设置保存失败");
    } finally {
      context.setCrmEmailIntegrationSaving(false);
    }
  };
}
