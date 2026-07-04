"use client";

import { useMemo, useState } from "react";
import type { AuthPayload, MenuItem } from "./types";
import type { WorkbenchTodo, WorkbenchTodosState } from "./types";
import styles from "./WorkspaceShell.module.css";

type WelcomePanelProps = {
  payload: AuthPayload;
  menus: MenuItem[];
  todosState: WorkbenchTodosState;
  bootWarnings?: string[];
  onSelectMenu: (key: string) => void;
  onRefreshTodos: () => void;
  onOpenTodo: (todo: WorkbenchTodo) => void;
};

function priorityLabel(priority: WorkbenchTodo["priority"]) {
  if (priority === "urgent") return "紧急";
  if (priority === "important") return "重要";
  return "普通";
}

function priorityClass(priority: WorkbenchTodo["priority"], dueAt?: string | null) {
  if (priority === "urgent") return styles.todoPriorityUrgent;
  if (priority === "important") return styles.todoPriorityImportant;
  return dueAt ? styles.todoPriorityNormal : styles.todoPriorityMuted;
}

function statusText(status: WorkbenchTodo["status"]) {
  return status === "DONE" || status === "ARCHIVED" || status === "completed" ? "已完成" : "待处理";
}

function isDueToday(dueAt?: string | null) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  return due.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) === now.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function isOverdue(dueAt?: string | null) {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date(new Date().toLocaleDateString("en-US", { timeZone: "Asia/Shanghai" }));
  return due < today;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function ownerRoleText(role?: WorkbenchTodo["ownerRole"]) {
  if (role === "LOGISTICS_SUPPLIER") return "物流供应商";
  if (role === "PRODUCT_SUPPLIER") return "产品供应商";
  if (role === "SALESPERSON") return "业务员";
  if (role === "FINANCE") return "财务";
  if (role === "PURCHASE") return "采购";
  if (role === "ADMIN") return "管理员";
  return "未分配";
}

function moduleMatches(todo: WorkbenchTodo, moduleFilter: string) {
  if (moduleFilter === "all") return true;
  if (moduleFilter === "finance") return ["收款管理", "成本管理"].includes(todo.module || "");
  return todo.module === moduleFilter;
}

function todoMatchesFilters(todo: WorkbenchTodo, filters: {
  workScope: string;
  ownerKind: string;
  ownerRole: string;
  moduleFilter: string;
  priorityFilter: string;
}) {
  if (filters.workScope === "mine" && !todo.isMine) return false;
  if (filters.ownerKind === "internal" && ["LOGISTICS_SUPPLIER", "PRODUCT_SUPPLIER"].includes(todo.ownerRole || "")) return false;
  if (filters.ownerKind === "supplier" && !["LOGISTICS_SUPPLIER", "PRODUCT_SUPPLIER"].includes(todo.ownerRole || "")) return false;
  if (filters.ownerRole !== "all" && todo.ownerRole !== filters.ownerRole) return false;
  if (!moduleMatches(todo, filters.moduleFilter)) return false;
  if (filters.priorityFilter !== "all" && todo.priority !== filters.priorityFilter) return false;
  return true;
}

export function WelcomePanel({
  payload,
  menus,
  todosState,
  bootWarnings = [],
  onSelectMenu,
  onRefreshTodos,
  onOpenTodo,
}: WelcomePanelProps) {
  const [workScope, setWorkScope] = useState("all");
  const [ownerKind, setOwnerKind] = useState("all");
  const [ownerRole, setOwnerRole] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const systemName = payload.companyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  const filters = useMemo(() => ({
    workScope,
    ownerKind,
    ownerRole,
    moduleFilter,
    priorityFilter,
  }), [moduleFilter, ownerKind, ownerRole, priorityFilter, workScope]);
  const filteredTodos = useMemo(() => (
    todosState.todos.filter((todo) => todoMatchesFilters(todo, filters))
  ), [filters, todosState.todos]);
  const filteredCompletedTodos = useMemo(() => (
    (todosState.completedTodos || []).filter((todo) => todoMatchesFilters(todo, filters))
  ), [filters, todosState.completedTodos]);
  const summary = useMemo(() => {
    const pending = filteredTodos.filter((todo) => todo.status === "ACTIVE" || todo.status === "pending");
    return {
      pending: pending.length,
      todayDue: pending.filter((todo) => isDueToday(todo.dueAt)).length,
      overdue: pending.filter((todo) => isOverdue(todo.dueAt)).length,
      completed: filteredCompletedTodos.length,
      total: pending.length,
      urgent: pending.filter((todo) => todo.priority === "urgent").length,
    };
  }, [filteredCompletedTodos.length, filteredTodos]);
  const cards = [
    { key: "pending", label: "待处理", value: summary.pending, className: styles.workbenchStatBlue },
    { key: "todayDue", label: "今日到期", value: summary.todayDue, className: styles.workbenchStatOrange },
    { key: "overdue", label: "已逾期", value: summary.overdue, className: styles.workbenchStatRed },
    { key: "completed", label: "已完成", value: summary.completed, className: styles.workbenchStatGreen },
  ];

  return (
    <section className={styles.workbenchPage}>
      <div className={styles.workbenchHero}>
        <div>
          <span className={styles.kicker}>Work Center</span>
          <h2>{systemName}</h2>
          <p>当前用户：{payload.user.name} / {payload.user.role}</p>
        </div>
        <p>{payload.permissions?.scopeText || payload.scopeText || "请选择左侧功能模块开始操作。"}</p>
      </div>

      {bootWarnings.length ? (
        <div className={styles.inlineError}>
          {bootWarnings.join("；")}
        </div>
      ) : null}

      <div className={styles.workbenchStatsGrid}>
        {cards.map((card) => (
          <div key={card.key} className={`${styles.workbenchStatCard} ${card.className}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className={styles.workbenchPanel}>
        <header className={styles.workbenchPanelHeader}>
          <div>
            <h3>我的待办</h3>
            <span>{todosState.loading ? "正在生成最新待办" : `当前筛选 ${summary.pending} 条待处理事项`}</span>
          </div>
          <button className={styles.primaryButtonCompact} type="button" onClick={onRefreshTodos} disabled={todosState.loading}>
            {todosState.loading ? "刷新中..." : "刷新"}
          </button>
        </header>
        <div className={styles.workbenchFilters}>
          <label>
            <span>工作范围</span>
            <select value={workScope} onChange={(event) => setWorkScope(event.target.value)}>
              <option value="all">全部工作</option>
              <option value="mine">只看我的工作</option>
            </select>
          </label>
          <label>
            <span>负责人</span>
            <select value={ownerKind} onChange={(event) => setOwnerKind(event.target.value)}>
              <option value="all">全部负责人</option>
              <option value="internal">当前系统用户</option>
              <option value="supplier">供应商用户</option>
            </select>
          </label>
          <label>
            <span>负责人角色</span>
            <select value={ownerRole} onChange={(event) => setOwnerRole(event.target.value)}>
              <option value="all">全部角色</option>
              <option value="SALESPERSON">业务员</option>
              <option value="PURCHASE">采购</option>
              <option value="FINANCE">财务</option>
              <option value="LOGISTICS_SUPPLIER">物流供应商</option>
              <option value="PRODUCT_SUPPLIER">产品供应商</option>
              <option value="ADMIN">管理员</option>
            </select>
          </label>
          <label>
            <span>来源模块</span>
            <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="应收订单">应收订单</option>
              <option value="物流信息">物流信息</option>
              <option value="物流费用">物流费用</option>
              <option value="资料回传">资料回传</option>
              <option value="退税资料">退税资料</option>
              <option value="finance">财务付款</option>
              <option value="利润分析">利润分析</option>
            </select>
          </label>
          <label>
            <span>优先级</span>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">全部</option>
              <option value="urgent">紧急</option>
              <option value="important">重要</option>
              <option value="normal">普通</option>
            </select>
          </label>
        </div>
        {todosState.error ? <div className={styles.inlineError}>{todosState.error}</div> : null}
        {filteredTodos.length ? (
          <div className={styles.workbenchTableWrap}>
            <table className={styles.workbenchTable}>
              <thead>
                <tr>
                  <th>优先级</th>
                  <th>待办事项标题</th>
                  <th>来源模块</th>
                  <th>关联订单号</th>
                  <th>客户简称</th>
                  <th>截止时间</th>
                  <th>当前状态</th>
                  <th>负责人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTodos.map((todo) => (
                  <tr key={todo.id}>
                    <td>
                      <span className={`${styles.todoPriorityBadge} ${priorityClass(todo.priority, todo.dueAt)}`}>
                        {priorityLabel(todo.priority)}
                      </span>
                    </td>
                    <td><strong title={todo.title}>{todo.title}</strong></td>
                    <td>{todo.module || "-"}</td>
                    <td>{todo.orderNo || "-"}</td>
                    <td>{todo.customerShortName || "-"}</td>
                    <td>{formatDateTime(todo.dueAt)}</td>
                    <td><span className={styles.todoStatusPill}>{statusText(todo.status)}</span></td>
                    <td>
                      <span>{todo.ownerName || "-"}</span>
                      <small className={styles.workbenchOwnerRole}>{ownerRoleText(todo.ownerRole)}</small>
                    </td>
                    <td>
                      <button className={styles.workbenchActionButton} type="button" onClick={() => onOpenTodo(todo)}>
                        {todo.action?.label || "处理"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyState}>{todosState.loading ? "正在加载待办..." : "当前筛选暂无待处理事项"}</div>
        )}
      </div>

      <div className={styles.quickGrid}>
        {menus.slice(0, 6).map((item) => (
          <button key={item.key} type="button" onClick={() => onSelectMenu(item.key)}>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
