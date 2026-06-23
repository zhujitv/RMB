import type { KeyboardEvent } from "react";

export function preventEnterFormSubmit(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter") return;

  const target = event.target as HTMLElement | null;
  const tagName = target?.tagName?.toLowerCase();

  if (tagName === "textarea" || target?.isContentEditable) return;

  event.preventDefault();
}
