import styles from "../../WorkspaceShell.module.css";
import { UiSwitch } from "../../components";
import localStyles from "./customs-product-whitelist-card.module.css";
import { SettingsCard } from "./settings-layout";
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
      <div className={localStyles.toolbar}>
        <p>只把命中白名单的报关品名自动填入合同；未命中内容只作为核查提示。</p>
        <div className={localStyles.toolbarActions}>
          <UiSwitch
            label="启用白名单模式"
            checked={form.customsProductWhitelistEnabled}
            className={localStyles.compactSwitch}
            onChange={(value) => onChange({ ...form, customsProductWhitelistEnabled: value })}
          />
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => onChange({ ...form, customsProductWhitelist: [...entries, newEntry()] })}
          >
            新增报关品名
          </button>
        </div>
      </div>
      {entries.length ? (
        <div className={localStyles.entryList}>
          {entries.map((entry, index) => (
            <section className={localStyles.entryRow} key={entry.id || index}>
              <label className={`${localStyles.field} ${localStyles.nameField}`}>
                <span>标准报关品名</span>
                <input value={entry.standardName} onChange={(event) => updateEntry(index, { standardName: event.target.value })} placeholder="例：塑料制墙板" />
              </label>
              <label className={`${localStyles.field} ${localStyles.aliasField}`}>
                <span>OCR 别名 / 常见错字</span>
                <textarea rows={2} value={listText(entry.aliases)} onChange={(event) => updateEntry(index, { aliases: splitList(event.target.value) })} placeholder="每行一个，例如：塑料墙板" />
              </label>
              <label className={`${localStyles.field} ${localStyles.hsField}`}>
                <span>HS Code（可选）</span>
                <textarea rows={2} value={listText(entry.hsCodes)} onChange={(event) => updateEntry(index, { hsCodes: splitList(event.target.value) })} placeholder="每行一个商品编号" />
              </label>
              <div className={localStyles.entryActions}>
                <UiSwitch
                  label="启用"
                  checked={entry.enabled}
                  className={localStyles.miniSwitch}
                  onChange={(value) => updateEntry(index, { enabled: value })}
                />
                <button className={styles.secondaryButton} type="button" onClick={() => removeEntry(index)}>删除</button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>暂无报关品名。可先添加常用报关品名，例如“塑料制墙板”“不锈钢连接件”。</div>
      )}
    </SettingsCard>
  );
}
