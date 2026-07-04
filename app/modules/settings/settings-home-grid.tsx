import styles from "../../WorkspaceShell.module.css";
import type { SettingsTabKey } from "./types";
import { SETTINGS_HOME_CARDS } from "./settings-view-constants";

export function SettingsHomeGrid({ onSelect }: { onSelect: (tab: SettingsTabKey) => void }) {
  return (
    <div className={styles.settingsHomeGrid}>
      {SETTINGS_HOME_CARDS.map((card) => (
        <button
          key={card.title}
          type="button"
          className={styles.settingsHomeCard}
          onClick={() => onSelect(card.tab)}
        >
          <span className={styles.settingsHomeIcon}>{card.icon}</span>
          <span>
            <strong>{card.title}</strong>
            <small>{card.description}</small>
          </span>
          <span className={styles.settingsHomeArrow}>进入</span>
        </button>
      ))}
    </div>
  );
}
