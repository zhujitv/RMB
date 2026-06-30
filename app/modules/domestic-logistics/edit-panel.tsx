import type { FormEvent } from "react";
import { useState } from "react";
import { apiJson } from "../../api";
import { preventEnterFormSubmit } from "../../formGuards";
import styles from "../../WorkspaceShell.module.css";
import { customerLegalName } from "../../utils";
import { CONTAINER_TYPE_OPTIONS, TRANSPORT_TYPES, emptyTransportItem, type DomesticLogisticsForm, type DomesticLogisticsRow, type TransportItem } from "./model";
import { addTransportItemText, formFromRow, generateRemark, normalizeFormTransportItems, showContainerManagementFields, transportFieldLabels, transportItemsTitle, validateDomesticLogisticsForm } from "./helpers";

export function DomesticLogisticsEditPanel({ row, onSaved, onCancel }: { row: DomesticLogisticsRow; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<DomesticLogisticsForm>(() => formFromRow(row));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function setFormValue<K extends keyof DomesticLogisticsForm>(key: K, value: DomesticLogisticsForm[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key !== "remarkText") {
        next.remarkText = generateRemark(next);
        next.remarkTextManualEdited = false;
      }
      return next;
    });
  }

  function updateItem(index: number, key: keyof TransportItem, value: string) {
    setForm((current) => {
      const transportItems = current.transportItems.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } : item
      ));
      const next = { ...current, transportItems };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  function addItem(copyPrevious = false) {
    setForm((current) => {
      const previous = current.transportItems[current.transportItems.length - 1] || emptyTransportItem();
      const transportItems = [...current.transportItems, copyPrevious ? { ...previous, containerNo: "" } : emptyTransportItem()];
      const next = { ...current, transportItems };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  function removeItem(index: number) {
    setForm((current) => {
      const transportItems = current.transportItems.filter((_, itemIndex) => itemIndex !== index);
      const next = { ...current, transportItems: transportItems.length ? transportItems : [emptyTransportItem()] };
      next.remarkText = generateRemark(next);
      next.remarkTextManualEdited = false;
      return next;
    });
  }

  async function regenerateRemark() {
    setForm((current) => ({ ...current, remarkText: generateRemark(current), remarkTextManualEdited: false }));
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateDomesticLogisticsForm(form);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const infoId = row.domesticLogisticsInfo?.id;
      const path = infoId ? `/api/domestic-logistics/${infoId}` : "/api/domestic-logistics";
      const isExpressPayload = form.transportType === "EXPRESS";
      const transportItems = isExpressPayload ? [] : normalizeFormTransportItems(form.transportItems);
      const firstItem = transportItems[0] || {};
      const remarkText = generateRemark({ ...form, transportItems });
      const result = await apiJson<{ success?: boolean; message?: string }>(path, {
        method: infoId ? "PATCH" : "POST",
        body: JSON.stringify({
          orderId: row.id,
          transportType: form.transportType,
          truckPlateNo: firstItem.truckPlateNo || "",
          trailerPlateNo: firstItem.trailerPlateNo || "",
          departurePlace: firstItem.departurePlace || "",
          departureDate: firstItem.departureDate || "",
          expressTrackingNo: isExpressPayload ? form.expressTrackingNo.trim() : "",
          destinationPlace: isExpressPayload ? form.destinationPlace.trim() : (firstItem.arrivalPlace || ""),
          cargoDescription: isExpressPayload ? form.cargoDescription.trim() : (firstItem.cargoName || ""),
          transportItems,
          remarkText,
          remarkTextManualEdited: false,
        }),
      });
      if (result.success !== true) throw new Error(result.message || "物流信息保存失败");
      onSaved();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "物流信息保存失败");
    } finally {
      setSaving(false);
    }
  }

  const isExpress = form.transportType === "EXPRESS";
  const transportLabels = transportFieldLabels(form.transportType);

  return (
    <>
    <form className={styles.inlineEditPanel} onKeyDown={preventEnterFormSubmit} onSubmit={submitForm} onClick={(event) => event.stopPropagation()}>
      <div className={styles.quickCreateHeader}>
        <div>
          <strong>录入物流信息 - {row.orderNo || "-"}</strong>
          <span>提单号：{row.blNo || row.billOfLadingNo || "-"} ｜ 客户全称：{customerLegalName(row)}</span>
        </div>
      </div>

      {message ? <div className={styles.inlineError}>{message}</div> : null}

      <div className={styles.reportFilterGrid}>
        <label>
          运输方式
          <select value={form.transportType} onChange={(event) => setFormValue("transportType", event.target.value)}>
            {TRANSPORT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </label>
        {isExpress ? (
          <>
            <label>
              快递单号
              <input value={form.expressTrackingNo} onChange={(event) => setFormValue("expressTrackingNo", event.target.value)} required />
            </label>
            <label>
              到达地
              <input value={form.destinationPlace} onChange={(event) => setFormValue("destinationPlace", event.target.value)} required />
            </label>
            <label>
              运输货物名称
              <input value={form.cargoDescription} onChange={(event) => setFormValue("cargoDescription", event.target.value)} required />
            </label>
          </>
        ) : null}
      </div>

      {!isExpress ? (
        <div className={styles.transportItemsPanel}>
          <div className={styles.transportItemsHeader}>
            <strong>{transportItemsTitle(form.transportType)}</strong>
            <div>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(false)}>{addTransportItemText(form.transportType)}</button>
              <button className={styles.secondaryButton} type="button" onClick={() => addItem(true)}>复制上一行</button>
            </div>
          </div>
          <div className={styles.transportItemsGrid}>
            {form.transportItems.map((item, index) => (
              <div className={styles.transportItemCard} key={`transport-item-${index}`}>
                <strong>第 {index + 1} 行</strong>
                <label>{transportLabels.containerNo}<input value={item.containerNo || ""} onChange={(event) => updateItem(index, "containerNo", event.target.value)} /></label>
                {showContainerManagementFields(form.transportType) ? (
                  <>
                    <label>
                      柜型
                      <select value={item.containerType || ""} onChange={(event) => updateItem(index, "containerType", event.target.value)}>
                        <option value="">请选择柜型</option>
                        {CONTAINER_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label>封号<input value={item.sealNo || ""} onChange={(event) => updateItem(index, "sealNo", event.target.value)} placeholder="可选" /></label>
                  </>
                ) : null}
                <label>{transportLabels.truckPlateNo}<input value={item.truckPlateNo || ""} onChange={(event) => updateItem(index, "truckPlateNo", event.target.value)} required /></label>
                <label>挂车车牌<input value={item.trailerPlateNo || ""} onChange={(event) => updateItem(index, "trailerPlateNo", event.target.value)} /></label>
                <label>{transportLabels.departureDate}<input type="date" value={item.departureDate || ""} onChange={(event) => updateItem(index, "departureDate", event.target.value)} required /></label>
                <label>{transportLabels.departurePlace}<input value={item.departurePlace || ""} onChange={(event) => updateItem(index, "departurePlace", event.target.value)} required /></label>
                <label>{transportLabels.arrivalPlace}<input value={item.arrivalPlace || ""} onChange={(event) => updateItem(index, "arrivalPlace", event.target.value)} required /></label>
                <label>{transportLabels.cargoName}<input value={item.cargoName || ""} onChange={(event) => updateItem(index, "cargoName", event.target.value)} required /></label>
                <label>备注<input value={item.remark || ""} onChange={(event) => updateItem(index, "remark", event.target.value)} /></label>
                <button className={styles.secondaryButton} type="button" onClick={() => removeItem(index)}>删除本行</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.detailActions}>
        <button className={styles.primaryButtonCompact} type="submit" disabled={saving}>{saving ? "提交中..." : "提交物流信息"}</button>
        <button className={styles.secondaryButton} type="button" onClick={onCancel} disabled={saving}>取消</button>
      </div>
    </form>
    </>
  );
}
