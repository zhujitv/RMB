"use client";

import type { AuthPayload, MenuItem } from "./types";
import type { WorkbenchTodo, WorkbenchTodosState } from "./types";
import styles from "./WorkspaceShell.module.css";

type WelcomePanelProps = {
  payload: AuthPayload;
  menus: MenuItem[];
  todosState: WorkbenchTodosState;
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
  return status === "completed" ? "已完成" : "待处理";
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

export function WelcomePanel({
  payload,
  menus,
  todosState,
  onSelectMenu,
  onRefreshTodos,
  onOpenTodo,
}: WelcomePanelProps) {
  const systemName = payload.companyProfile?.systemName?.trim() || "NEXTWOOD 供应链协同平台";
  const summary = todosState.summary;
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
            <span>{todosState.loading ? "正在生成最新待办" : `共 ${summary.pending} 条待处理事项`}</span>
          </div>
          <button className={styles.primaryButtonCompact} type="button" onClick={onRefreshTodos} disabled={todosState.loading}>
            {todosState.loading ? "刷新中..." : "刷新"}
          </button>
        </header>
        {todosState.error ? <div className={styles.inlineError}>{todosState.error}</div> : null}
        {todosState.todos.length ? (
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
                {todosState.todos.map((todo) => (
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
                    <td>{todo.ownerName || "-"}</td>
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
          <div className={styles.emptyState}>{todosState.loading ? "正在加载待办..." : "暂无待处理事项"}</div>
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
