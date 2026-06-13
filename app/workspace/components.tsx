"use client";

import type { KeyboardEvent } from "react";
import styles from "./WorkspaceShell.module.css";

export function DetailField({
  label,
  value,
  wide = false,
  hidden = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
  hidden?: boolean;
}) {
  if (hidden || !value || value === "-") return null;
  return (
    <div className={`${styles.detailField} ${wide ? styles.detailFieldWide : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PaginationBar({
  total,
  page,
  totalPages,
  loading = false,
  onPage,
}: {
  total: number;
  page: number;
  totalPages: number;
  loading?: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <div className={styles.paginationBar}>
      <span>共 {total} 条，当前第 {page} / {totalPages} 页</span>
      <div>
        <button className={styles.secondaryButton} type="button" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))}>上一页</button>
        <button className={styles.secondaryButton} type="button" disabled={page >= totalPages || loading} onClick={() => onPage(Math.min(totalPages, page + 1))}>下一页</button>
      </div>
    </div>
  );
}

export function handleSearchOptionKey<T>({
  event,
  options,
  selectedId,
  getId,
  onSelect,
}: {
  event: KeyboardEvent<HTMLInputElement>;
  options: T[];
  selectedId: string;
  getId: (option: T) => string;
  onSelect: (id: string, option: T) => void;
}) {
  if (!["ArrowDown", "ArrowUp"].includes(event.key) || !options.length) return false;
  event.preventDefault();
  const currentIndex = options.findIndex((option) => getId(option) === selectedId);
  const nextIndex = currentIndex < 0
    ? (event.key === "ArrowDown" ? 0 : options.length - 1)
    : event.key === "ArrowDown"
      ? (currentIndex + 1) % options.length
      : (currentIndex - 1 + options.length) % options.length;
  const nextOption = options[nextIndex];
  onSelect(getId(nextOption), nextOption);
  return true;
}
