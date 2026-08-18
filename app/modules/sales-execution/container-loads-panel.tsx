"use client";

import { useState } from "react";
import type { ContainerLoad } from "../container-load";
import styles from "../container-loads.module.css";
import { ContainerLoadCard } from "./container-load-card";
import { ContainerLoadEditor } from "./container-load-editor";
import type { FactoryPurchaseOrder } from "./types";

export function ContainerLoadsPanel({ executionId, executionRevision, loads, orders, canManage, shippingStarted, onChanged }: {
  executionId: string;
  executionRevision: number;
  loads: ContainerLoad[];
  orders: FactoryPurchaseOrder[];
  canManage: boolean;
  shippingStarted: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<ContainerLoad | null | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const activeOrders = orders.filter((order) => order.status === "ACCEPTED");

  async function saved(message: string) {
    setNotice(message);
    await onChanged();
  }

  return <section className={styles.panel} aria-labelledby="container-loads-heading">
    <header className={styles.header}><div><p className={styles.eyebrow}>装运协同</p><h3 id="container-loads-heading">装柜 / 散货进舱总单</h3><p>这里先确认多家供应商的实际装运数量，柜号、柜型、封号和提单等资料可在后续物流环节填写；散货进舱无需柜号。</p></div>{canManage && !shippingStarted ? <button className={styles.button} type="button" disabled={!activeOrders.length} onClick={() => setEditing(null)}>创建装运单</button> : null}</header>
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {!loads.length ? <div className={styles.empty}>尚未创建装运单。整柜按集装箱登记；散货可直接按进舱批次登记，不需要柜号。</div> : <div className={styles.resultList}>{loads.map((load) => <ContainerLoadCard key={load.id} executionId={executionId} load={load} allLoads={loads} orders={orders} canManage={canManage} shippingStarted={shippingStarted} onEdit={() => setEditing(load)} onSaved={saved} />)}</div>}
    {editing !== undefined ? <ContainerLoadEditor executionId={executionId} executionRevision={executionRevision} orders={orders} loads={loads} editing={editing} onSaved={saved} onClose={() => setEditing(undefined)} /> : null}
  </section>;
}
