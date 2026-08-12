import { Prisma } from "../generated/prisma/client.js";
import { codedError } from "./shared-base-utils";
import { CURRENCIES } from "./shared-cost-constants";
import { quotationDate, quotationDecimal, quotationText } from "./quotation-values";

export function salesExecutionCurrency(value: unknown, fallback = "USD") {
  const currency = quotationText(value ?? fallback, "币种", 10, true).toUpperCase();
  if (!CURRENCIES.includes(currency)) {
    throw codedError("请选择有效币种", 400, "SALES_EXECUTION_CURRENCY_INVALID");
  }
  return currency;
}

export function salesExecutionDate(value: unknown, label: string, fallback?: Date | null) {
  return quotationDate(value, label, fallback);
}

export function requiredCustomerOrderNo(value: unknown) {
  if (!String(value ?? "").trim()) {
    throw codedError(
      "客户订单号不能为空",
      400,
      "SALES_EXECUTION_CUSTOMER_ORDER_NO_REQUIRED",
    );
  }
  return executionText(value, "客户订单号", 100, true);
}

export function requiredRequestedDeliveryDate(value: unknown) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw codedError(
        "客户要求交货日期格式错误",
        400,
        "SALES_EXECUTION_REQUESTED_DELIVERY_DATE_INVALID",
      );
    }
    return value;
  }
  try {
    const requestedDeliveryDate = salesExecutionDate(value, "客户要求交货日期", null);
    if (!requestedDeliveryDate) {
      throw codedError(
        "客户要求交货日期不能为空",
        400,
        "SALES_EXECUTION_REQUESTED_DELIVERY_DATE_REQUIRED",
      );
    }
    return requestedDeliveryDate;
  } catch (error: unknown) {
    if (String((error as { code?: string } | null)?.code || "") === "QUOTATION_DATE_INVALID") {
      throw codedError(
        "客户要求交货日期格式错误",
        400,
        "SALES_EXECUTION_REQUESTED_DELIVERY_DATE_INVALID",
      );
    }
    throw error;
  }
}

type SalesExecutionCreationCredentials = {
  customerOrderNo: string;
  requestedDeliveryDate: Date;
};

function creationCredentialDateKey(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  try {
    return salesExecutionDate(value, "客户要求交货日期", null)?.toISOString().slice(0, 10) || "";
  } catch {
    return "";
  }
}

export function assertSalesExecutionCreationCredentials(
  existing: { customerOrderNo: unknown; requestedDeliveryDate: unknown },
  requested: SalesExecutionCreationCredentials,
) {
  const mismatchedFields: string[] = [];
  const existingCustomerOrderNo = String(existing.customerOrderNo ?? "").trim().replace(/\s+/g, " ");
  if (existingCustomerOrderNo !== requested.customerOrderNo) mismatchedFields.push("客户订单号");
  if (
    creationCredentialDateKey(existing.requestedDeliveryDate)
    !== creationCredentialDateKey(requested.requestedDeliveryDate)
  ) {
    mismatchedFields.push("客户要求交货日期");
  }
  if (mismatchedFields.length) {
    throw codedError(
      `销售执行单已经存在，但本次${mismatchedFields.join("、")}与原记录不一致，不能重复创建`,
      409,
      "SALES_EXECUTION_CREATION_CREDENTIAL_CONFLICT",
    );
  }
}

export function salesExecutionDecimal(
  value: unknown,
  label: string,
  options: { positive?: boolean; scale: number; integerDigits: number },
) {
  return quotationDecimal(value, label, options);
}

export function nullableSalesExecutionDecimal(
  value: unknown,
  label: string,
  options: { positive?: boolean; scale: number; integerDigits: number },
) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return salesExecutionDecimal(value, label, options);
}

export function nullableDecimalSubtotal(values: Array<Prisma.Decimal | null>) {
  let subtotal = new Prisma.Decimal(0);
  for (const value of values) {
    if (value === null) return null;
    subtotal = subtotal.add(value);
  }
  return subtotal.toDecimalPlaces(2);
}

export function salesExecutionSource(value: unknown) {
  const source = String(value || "DIRECT").trim().toUpperCase();
  if (!(["DIRECT", "QUOTATION"] as string[]).includes(source)) {
    throw codedError("销售执行单来源无效", 400, "SALES_EXECUTION_SOURCE_INVALID");
  }
  return source as "DIRECT" | "QUOTATION";
}

export function executionText(value: unknown, label: string, max = 500, required = false) {
  return quotationText(value, label, max, required);
}

export {
  decimalText,
  executionRecord,
  nullableDecimalText,
  salesExecutionSnapshot,
  serializeSalesExecution,
} from "./sales-execution-serialization";
