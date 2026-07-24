import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import { useWorkspaceTabBusy, useWorkspaceTabDirty } from "../../workspace/workspace-tab-context";
import type { LogisticsInvoiceValidationRules } from "./types";

export type OcrValidationRulesDraft = {
  validationRules: LogisticsInvoiceValidationRules | null;
  rulesLoading: boolean;
  rulesSaving: boolean;
  rulesMessage: string;
  updateRuleKeywords: (key: string, value: string) => void;
  saveValidationRules: () => Promise<void>;
};

export function useOcrValidationRulesDraft(enabled: boolean): OcrValidationRulesDraft {
  const [validationRules, setValidationRules] = useState<LogisticsInvoiceValidationRules | null>(null);
  const [savedValidationRules, setSavedValidationRules] = useState<LogisticsInvoiceValidationRules | null>(null);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesMessage, setRulesMessage] = useState("");

  useEffect(() => {
    if (!enabled || rulesLoaded) return;
    let alive = true;
    setRulesLoading(true);
    setRulesMessage("");
    apiJson<{ rules?: LogisticsInvoiceValidationRules }>("/api/settings/logistics-invoice-validation-rules")
      .then((result) => {
        if (!alive) return;
        const nextRules = result.rules || {};
        setValidationRules(nextRules);
        setSavedValidationRules(nextRules);
      })
      .catch((error) => {
        if (alive) setRulesMessage(error instanceof Error ? error.message : "物流费用发票校验规则加载失败");
      })
      .finally(() => {
        if (!alive) return;
        setRulesLoading(false);
        setRulesLoaded(true);
      });
    return () => { alive = false; };
  }, [enabled, rulesLoaded]);

  const validationRulesDirty = Boolean(validationRules && savedValidationRules
    && JSON.stringify(validationRules) !== JSON.stringify(savedValidationRules));
  useWorkspaceTabDirty(validationRulesDirty);
  useWorkspaceTabBusy(rulesSaving);

  function updateRuleKeywords(key: string, value: string) {
    setValidationRules((current) => {
      const rules = current || {};
      const existing = rules[key] || { label: key, keywords: [] };
      return {
        ...rules,
        [key]: {
          ...existing,
          keywords: value.split(/[\n,，;；]+/).map((item) => item.trim()).filter(Boolean),
        },
      };
    });
  }

  async function saveValidationRules() {
    if (!validationRules) return;
    setRulesSaving(true);
    setRulesMessage("");
    try {
      const result = await apiJson<{ success?: boolean; message?: string; rules?: LogisticsInvoiceValidationRules }>(
        "/api/settings/logistics-invoice-validation-rules",
        { method: "PATCH", body: JSON.stringify({ rules: validationRules }) },
      );
      if (result.success !== true) throw new Error(result.message || "物流费用发票校验规则保存失败");
      const savedRules = result.rules || validationRules;
      setValidationRules(savedRules);
      setSavedValidationRules(savedRules);
      setRulesMessage(result.message || "物流费用发票校验规则已保存");
    } catch (error) {
      setRulesMessage(error instanceof Error ? error.message : "物流费用发票校验规则保存失败");
    } finally {
      setRulesSaving(false);
    }
  }

  return { validationRules, rulesLoading, rulesSaving, rulesMessage, updateRuleKeywords, saveValidationRules };
}
