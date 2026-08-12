"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { QuotationFormPanel } from "./quotation-form-panel";
import type {
  BusinessEntitiesResponse,
  QuotationBusinessEntity,
  QuotationRow,
} from "./types";

export function QuotationFormContainer({
  initialQuotation,
  onCancel,
  onSaved,
}: {
  initialQuotation?: QuotationRow | null;
  onCancel: () => void;
  onSaved: (quotation: QuotationRow, message: string) => void;
}) {
  const [entities, setEntities] = useState<QuotationBusinessEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void apiJson<BusinessEntitiesResponse>("/api/business-entities")
      .then((result) => {
        if (active) setEntities(Array.isArray(result.entities) ? result.entities : []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "读取业务主体失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) return <div className={shell.emptyState}>正在读取业务主体...</div>;
  if (error) return <div className={shell.inlineError}>业务主体读取失败：{error}</div>;
  if (!entities.length) return <div className={shell.inlineError}>请先在系统设置中维护可用业务主体。</div>;
  return (
    <QuotationFormPanel
      initialQuotation={initialQuotation}
      businessEntities={entities}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  );
}
