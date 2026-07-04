import styles from "../WorkspaceShell.module.css";
import { PASSWORD_POLICY_MESSAGE, passwordMeetsPolicy } from "../../lib/password-policy";

export function formatDateTime(value?: string | Date | null) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function passwordStrength(password: string) {
  if (!password) return { label: "未输入", className: styles.passwordStrengthMuted };
  if (!passwordMeetsPolicy(password)) return { label: "弱", className: styles.passwordStrengthWeak };
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  if (password.length >= 12 && hasNumber && hasSymbol) return { label: "强", className: styles.passwordStrengthStrong };
  return { label: "中", className: styles.passwordStrengthMedium };
}
