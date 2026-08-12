"use client";

import { useEffect, useState } from "react";
import { apiJson } from "../../api";
import shell from "../../WorkspaceShell.module.css";
import { ExecutionFormPanel } from "./execution-form-panel";
import type { BusinessEntityOption, SalesExecutionRow, SupplierOption } from "./types";

type BusinessEntitiesResponse = { entities?: BusinessEntityOption[] };
type SuppliersResponse = { suppliers?: SupplierOption[] };

export function ExecutionFormContainer({
  initialExecution,
  onCancel,
  onSaved,
}: {
  initialExecution?: SalesExecutionRow | null;
  onCancel: () => void;
  onSaved: (execution: SalesExecutionRow, message: string) => void;
}) {
  const [entities, setEntities] = useState<BusinessEntityOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      apiJson<BusinessEntitiesResponse>("/api/business-entities"),
      apiJson<SuppliersResponse>("/api/suppliers/available?type=factory"),
    ]).then(([entityResult, supplierResult]) => {
      if (!active) return;
      setEntities(Array.isArray(entityResult.entities) ? entityResult.entities : []);
      setSuppliers(Array.isArray(supplierResult.suppliers) ? supplierResult.suppliers : []);
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "读取销售执行基础资料失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  if (loading) return <div className={shell.emptyState}>正在读取业务主体和工厂资料...</div>;
  if (error) return <div className={shell.inlineError}>基础资料读取失败：{error}</div>;
  if (!entities.length) return <div className={shell.inlineError}>请先在系统设置中维护可用业务主体。</div>;
  if (!suppliers.length) return <div className={shell.inlineError}>请先在系统设置中维护已启用的产品供应商。</div>;
  return <ExecutionFormPanel initialExecution={initialExecution} businessEntities={entities} suppliers={suppliers} onCancel={onCancel} onSaved={onSaved} />;
}
