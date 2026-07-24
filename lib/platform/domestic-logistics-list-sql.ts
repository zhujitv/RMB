import { Prisma } from "../generated/prisma/client.js";
import { nonEmpty } from "./shared";
import { isExternalLogisticsSupplierAccount } from "./masters-access";
import {
  actorRole,
  type DomesticLogisticsActorInput,
  type DomesticLogisticsListFilters,
} from "./domestic-logistics-context";

export function isShipsgoTrackingSchemaError(error: unknown) {
  const message = String((error as { message?: unknown } | null | undefined)?.message || error || "");
  return /shipsgo_trackings|ShipsgoTracking|shipsgoTrackings/i.test(message)
    && /(does not exist|not exist|relation|table|column|Unknown field|Unknown argument)/i.test(message);
}

export function domesticLogisticsListSqlWhere(filters: DomesticLogisticsListFilters, actor: DomesticLogisticsActorInput) {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`ro.deleted_at IS NULL`,
  ];
  if (filters.businessScope === "archive") {
    conditions.push(Prisma.sql`ro.is_archived = true`);
  } else if (filters.businessScope === "current") {
    conditions.push(Prisma.sql`ro.is_archived = false`);
    conditions.push(Prisma.sql`ro.status NOT IN ('已关闭', '已取消')`);
  }
  if (actorRole(actor) === "业务员") {
    const currentActorId = nonEmpty(actor?.id);
    conditions.push(currentActorId
      ? Prisma.sql`(ro.salesperson_user_id = ${currentActorId} OR (ro.salesperson_user_id IS NULL AND c.salesperson_user_id = ${currentActorId}))`
      : Prisma.sql`1 = 0`);
  }
  if (isExternalLogisticsSupplierAccount(actor)) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1
      FROM order_logistics_suppliers ols_scope
      WHERE ols_scope.order_id = ro.id
        AND ols_scope.supplier_id = ${nonEmpty(actor.supplierId)}
    )`);
  } else if (actorRole(actor) === "物流供应商") {
    conditions.push(Prisma.sql`1 = 0`);
  }
  if (filters.keyword) {
    const keyword = `%${filters.keyword}%`;
    conditions.push(Prisma.sql`(
      ro.order_no ILIKE ${keyword}
      OR ro.bl_no ILIKE ${keyword}
      OR ro.customer_name_snapshot ILIKE ${keyword}
      OR c.name ILIKE ${keyword}
      OR c.short_name ILIKE ${keyword}
      OR EXISTS (
        SELECT 1
        FROM order_logistics_suppliers ols_keyword
        JOIN suppliers s_keyword ON s_keyword.id = ols_keyword.supplier_id
        WHERE ols_keyword.order_id = ro.id
          AND (
            s_keyword.supplier_name ILIKE ${keyword}
            OR s_keyword.supplier_type ILIKE ${keyword}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM domestic_logistics_infos dli_keyword
        LEFT JOIN domestic_logistics_transport_items dti_keyword
          ON dti_keyword.logistics_info_id = dli_keyword.id
        WHERE dli_keyword.order_id = ro.id
          AND dli_keyword.deleted_at IS NULL
          AND (
            dli_keyword.remark_text ILIKE ${keyword}
            OR dti_keyword.container_no ILIKE ${keyword}
            OR dti_keyword.container_type ILIKE ${keyword}
            OR dti_keyword.seal_no ILIKE ${keyword}
          )
      )
    )`);
  }
  return Prisma.sql`${Prisma.join(conditions, " AND ")}`;
}

export function domesticLogisticsSupplierStatusSql(actor: DomesticLogisticsActorInput, alias: "lb" | "le") {
  if (!isExternalLogisticsSupplierAccount(actor)) return Prisma.empty;
  const supplierId = nonEmpty(actor.supplierId);
  return alias === "lb"
    ? Prisma.sql`AND lb.supplier_id = ${supplierId}`
    : Prisma.sql`AND le.supplier_id = ${supplierId}`;
}
