import type { User } from "../types";
import styles from "../WorkspaceShell.module.css";
import { ACCOUNT_TABS, type AccountTab } from "./model";

export function AccountSettingsHeader({
  user,
  avatarText,
  avatarUrl,
}: {
  user: User;
  avatarText: string;
  avatarUrl: string;
}) {
  return (
    <div className={styles.accountSettingsHeader}>
      {avatarUrl ? (
        <img className={styles.accountAvatarImage} src={avatarUrl} alt="用户头像" />
      ) : (
        <span className={styles.avatarLarge}>{avatarText}</span>
      )}
      <div>
        <h2>{user.name}</h2>
        <p>{user.role} · {user.email}</p>
      </div>
    </div>
  );
}

export function AccountSettingsTabs({
  activeTab,
  busy,
  onSelect,
}: {
  activeTab: AccountTab;
  busy: boolean;
  onSelect: (tab: AccountTab) => void;
}) {
  return (
    <nav className={styles.accountTabList} aria-label="个人设置">
      {ACCOUNT_TABS.map((item) => (
        <button
          key={item.key}
          className={activeTab === item.key ? styles.accountTabActive : ""}
          type="button"
          disabled={busy}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
