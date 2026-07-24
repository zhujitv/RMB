"use client";

import { useMemo, useState } from "react";
import styles from "../WorkspaceShell.module.css";
import { useWorkspaceTabContext } from "../workspace/workspace-tab-context";
import { FLOW_STEPS, SECTIONS, type ManualSection } from "./manual-content";

export function ManualModule() {
  const workspaceTab = useWorkspaceTabContext();
  const [query, setQuery] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(() => (
    new Set(SECTIONS.filter((section) => section.defaultOpen).map((section) => section.id))
  ));

  const normalizedQuery = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!normalizedQuery) return SECTIONS;
    return SECTIONS.filter((section) => sectionText(section).toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery]);

  function toggleSection(id: string) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenSections(new Set(SECTIONS.map((section) => section.id)));
  }

  function collapseAll() {
    setOpenSections(new Set());
  }

  function scrollToSection(id: string) {
    setOpenSections((current) => new Set(current).add(id));
    requestAnimationFrame(() => {
      const targetId = `manual-${id}`;
      const target = workspaceTab?.portalTarget?.parentElement?.querySelector<HTMLElement>(`#${CSS.escape(targetId)}`)
        || document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <section className={styles.manualPage}>
      <div className={styles.manualHero}>
        <div>
          <span className={styles.kicker}>NEXTWOOD Handbook</span>
          <h2>操作手册</h2>
          <p>供应链业务、单证、物流费用与退税资料协同平台操作手册</p>
          <div className={styles.manualMeta}>
            <span>当前版本：v3.0</span>
            <span>适用对象：业务 / 财务 / 成本 / 物流 / 管理员</span>
            <span>更新时间：{new Date().toLocaleDateString("zh-CN")}</span>
          </div>
        </div>
        <div className={styles.manualHeroBadge}>
          <strong>一票业务</strong>
          <span>一个订单 · 一套资料 · 一次归档</span>
        </div>
      </div>

      <div className={styles.manualToolbar}>
        <label>
          <span>搜索手册</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索章节、操作步骤、注意事项" />
        </label>
        <div>
          <button className={styles.secondaryButton} type="button" onClick={expandAll}>展开全部</button>
          <button className={styles.secondaryButton} type="button" onClick={collapseAll}>收起全部</button>
        </div>
      </div>

      <div className={styles.manualFlow}>
        {FLOW_STEPS.map(([title, text], index) => (
          <div key={title} className={styles.manualFlowCard}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{title}</strong>
            <small>{text}</small>
          </div>
        ))}
      </div>

      <div className={styles.manualLayout}>
        <aside className={styles.manualToc}>
          {SECTIONS.map((section) => (
            <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>
              {section.no} {section.title}
            </button>
          ))}
        </aside>

        <div className={styles.manualContent}>
          {sections.length ? sections.map((section) => (
            <article key={section.id} id={`manual-${section.id}`} className={styles.manualSectionCard}>
              <button type="button" onClick={() => toggleSection(section.id)}>
                <span>{section.no}</span>
                <strong>{highlight(section.title, query)}</strong>
                <i>{openSections.has(section.id) ? "收起" : "展开"}</i>
              </button>
              {openSections.has(section.id) ? (
                <div className={styles.manualSectionBody}>
                  <p>{highlight(section.summary, query)}</p>
                  <div className={styles.manualSectionGrid}>
                    <div>
                      <h4>关键操作</h4>
                      <ul>{section.steps.map((item) => <li key={item}>{highlight(item, query)}</li>)}</ul>
                    </div>
                    <div>
                      <h4>注意事项</h4>
                      <ul>{section.notes.map((item) => <li key={item}>{highlight(item, query)}</li>)}</ul>
                    </div>
                  </div>
                  <p className={styles.manualEntryTip}>相关入口：{section.entry}</p>
                </div>
              ) : null}
            </article>
          )) : (
            <div className={styles.emptyState}>未找到匹配的手册内容</div>
          )}
        </div>
      </div>

      <button className={styles.manualBackTop} type="button" onClick={() => scrollTo({ top: 0, behavior: "smooth" })}>
        返回顶部
      </button>
    </section>
  );
}
function sectionText(section: ManualSection) {
  return [section.title, section.summary, ...section.steps, ...section.notes, section.entry].join(" ");
}

function highlight(text: string, query: string) {
  const value = String(text || "");
  const keyword = query.trim();
  if (!keyword) return value;
  const index = value.toLowerCase().indexOf(keyword.toLowerCase());
  if (index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark>{value.slice(index, index + keyword.length)}</mark>
      {value.slice(index + keyword.length)}
    </>
  );
}
