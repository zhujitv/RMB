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
    <header className={styles.header}><div><p className={styles.eyebrow}>装柜协同</p><h3 id="container-loads-heading">集装箱柜总单</h3><p>先创建一个柜，再把多家供应商的采购明细分配到同一柜；供应商只会看到自己的部分。</p></div>{canManage && !shippingStarted ? <button className={styles.button} type="button" disabled={!activeOrders.length} onClick={() => setEditing(null)}>创建柜总单</button> : null}</header>
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
    {!loads.length ? <div className={styles.empty}>尚未创建柜总单。生产完成后，可按实际装柜计划把多家供应商合并到同一个集装箱。</div> : <div className={styles.resultList}>{loads.map((load) => <ContainerLoadCard key={load.id} executionId={executionId} load={load} allLoads={loads} orders={orders} canManage={canManage} shippingStarted={shippingStarted} onEdit={() => setEditing(load)} onSaved={saved} />)}</div>}
    {editing !== undefined ? <ContainerLoadEditor executionId={executionId} executionRevision={executionRevision} orders={orders} loads={loads} editing={editing} onSaved={saved} onClose={() => setEditing(undefined)} /> : null}
  </section>;
}
