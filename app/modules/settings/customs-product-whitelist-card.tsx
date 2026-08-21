import styles from "../../WorkspaceShell.module.css";
import { SettingsCard, SettingsSwitch } from "./settings-layout";
import type { CustomsProductWhitelistEntry, OcrIntegrationForm } from "./types";

function listText(value: string[]) {
  return value.join("\n");
}

function splitList(value: string) {
  return value.split(/[\n,;；、]+/g).map((item) => item.trim()).filter(Boolean);
}

function newEntry(): CustomsProductWhitelistEntry {
  return {
    id: `customs-product-${Date.now()}`,
    standardName: "",
    aliases: [],
    hsCodes: [],
    enabled: true,
  };
}

export function CustomsProductWhitelistCard({
  form,
  onChange,
}: {
  form: OcrIntegrationForm;
  onChange: (form: OcrIntegrationForm) => void;
}) {
  const entries = form.customsProductWhitelist || [];
  function updateEntry(index: number, patch: Partial<CustomsProductWhitelistEntry>) {
    onChange({
      ...form,
      customsProductWhitelist: entries.map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, ...patch } : entry
      )),
    });
  }
  function removeEntry(index: number) {
    onChange({ ...form, customsProductWhitelist: entries.filter((_, entryIndex) => entryIndex !== index) });
  }
  return (
    <SettingsCard title="报关品名白名单" icon="白">
      <div className={styles.emptyState}>
        启用后，报关单 OCR 只会自动填入白名单命中的报关品名；未命中的识别文本会保留为核查提示，不进入自动合同品名。
      </div>
      <SettingsSwitch
        label="启用白名单模式"
        tooltip="适合报关品名比较固定的业务。标准品名用于合同，别名用于纠正 OCR 常见识别差异。"
        checked={form.customsProductWhitelistEnabled}
        onChange={(value) => onChange({ ...form, customsProductWhitelistEnabled: value })}
      />
      <div className={styles.inlineActionGroup}>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => onChange({ ...form, customsProductWhitelist: [...entries, newEntry()] })}
        >
          新增报关品名
        </button>
      </div>
      {entries.length ? (
        <div className={styles.settingsFieldGrid}>
          {entries.map((entry, index) => (
            <div className={styles.notificationTemplateField} key={entry.id || index}>
              <label>
                标准报关品名
                <input
                  value={entry.standardName}
                  onChange={(event) => updateEntry(index, { standardName: event.target.value })}
                  placeholder="例：塑料制墙板"
                />
              </label>
              <label>
                OCR 别名 / 常见错字
                <textarea
                  rows={3}
                  value={listText(entry.aliases)}
                  onChange={(event) => updateEntry(index, { aliases: splitList(event.target.value) })}
                  placeholder="每行一个，例如：塑料墙板"
                />
              </label>
              <label>
                HS Code（可选）
                <textarea
                  rows={2}
                  value={listText(entry.hsCodes)}
                  onChange={(event) => updateEntry(index, { hsCodes: splitList(event.target.value) })}
                  placeholder="每行一个商品编号"
                />
              </label>
              <div className={styles.inlineActionGroup}>
                <SettingsSwitch
                  label="启用该品名"
                  checked={entry.enabled}
                  onChange={(value) => updateEntry(index, { enabled: value })}
                />
                <button className={styles.secondaryButton} type="button" onClick={() => removeEntry(index)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>暂无报关品名。可先添加常用报关品名，例如“塑料制墙板”“不锈钢连接件”。</div>
      )}
    </SettingsCard>
  );
}
