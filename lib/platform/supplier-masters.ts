import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LEGACY_FACTORY_SUPPLIER_TYPE,
  LOGISTICS_SUPPLIER_TYPE_CODE,
  PRODUCT_SUPPLIER_TYPE_CODE,
  PRODUCT_SUPPLIER_TYPES,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  assertRead,
  assertWrite,
  booleanInput,
  codedError,
  nonEmpty,
  normalizeLogisticsCostTypeList,
  optional,
  pageParams,
  pageResult,
  permissionError,
  requireText,
  runNonCriticalTask,
  serializeSupplier,
  serializeSupplierOption,
  supplierTypeStorageValue,
  writeAudit,
} from "./shared";
import { normalizeChinaMobilePhone } from "./sms-integration-config";
import {
  AVAILABLE_SUPPLIER_SELECT,
  canListAvailableSupplierOptions,
  canReadFullSupplierRecords,
  supplierListWhere,
  type SupplierSelectionActor,
  type SupplierSelectionQuery,
} from "./supplier-selection";

type ListOptions = { paginated?: boolean };
type SupplierInput = Record<string, unknown>;
type QueryLike = SupplierSelectionQuery;
type AuditRequestLike = Parameters<typeof writeAudit>[0];
type ActorLike = SupplierSelectionActor;

export async function listSuppliers(query: QueryLike, actor: ActorLike = null, onlyActive = false, options: ListOptions = {}) {
  if (!onlyActive) {
    assertRead(actor, "suppliers");
  } else if (!canListAvailableSupplierOptions(actor)) {
    throw permissionError("没有权限搜索供应商");
  }
  const where = supplierListWhere(query, actor, onlyActive);
  if (options.paginated) {
    const { page, pageSize } = pageParams(query, 20, 100);
    const [total, suppliers] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        include: { createdBy: true, updatedBy: true },
        orderBy: [{ supplierName: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return pageResult(suppliers.map(serializeSupplier), total, page, pageSize);
  }
  const suppliers = await prisma.supplier.findMany({
    where,
    include: { createdBy: true, updatedBy: true },
    orderBy: [{ supplierName: "asc" }],
    take: onlyActive ? 200 : undefined,
  });
  return suppliers.map(serializeSupplier);
}

export async function listAvailableSuppliers(query: QueryLike, actor: ActorLike) {
  if (!canListAvailableSupplierOptions(actor)) {
    throw permissionError("没有权限搜索供应商");
  }
  const where = supplierListWhere(query, actor, true);
  if (canReadFullSupplierRecords(actor)) {
    const suppliers = await prisma.supplier.findMany({
      where,
      include: { createdBy: true, updatedBy: true },
      orderBy: [{ supplierName: "asc" }],
      take: 200,
    });
    return suppliers.map(serializeSupplier);
  }
  const supplierOptions = await prisma.supplier.findMany({
    where,
    select: AVAILABLE_SUPPLIER_SELECT,
    orderBy: [{ supplierName: "asc" }],
    take: 200,
  });
  return supplierOptions.map(serializeSupplierOption);
}

export async function assertSupplierActive(supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, deletedAt: null },
    include: { createdBy: true, updatedBy: true },
  });
  if (!supplier) {
    throw codedError("请选择有效供应商", 400, "SUPPLIER_REQUIRED");
  }
  if (supplier.status !== "启用") {
    throw codedError("供应商已停用，不能用于成本录入", 400, "SUPPLIER_REQUIRED");
  }
  return supplier;
}

export async function saveSupplier(request: AuditRequestLike, actor: ActorLike, input: SupplierInput, id: string | null = null) {
  assertWrite(actor, "suppliers");
  const actorId = requireText(actor?.id, "当前用户");
  const supplierName = requireText(input.supplierName || input.name, "供应商名称");
  const before = id
    ? await prisma.supplier.findFirst({ where: { id, deletedAt: null }, include: { createdBy: true, updatedBy: true } })
    : null;
  if (id && !before) {
    throw codedError("供应商不存在或已删除", 404, "SUPPLIER_NOT_FOUND");
  }
  const duplicate = await prisma.supplier.findFirst({
    where: {
      supplierName: { equals: supplierName, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    throw codedError("供应商名称已存在，不能重复创建", 409, "SUPPLIER_DUPLICATE");
  }
  const requestedSupplierType = nonEmpty(input.supplierType);
  const supplierType = SUPPLIER_TYPES.includes(requestedSupplierType) ||
    requestedSupplierType === LEGACY_FACTORY_SUPPLIER_TYPE ||
    requestedSupplierType === PRODUCT_SUPPLIER_TYPE_CODE ||
    requestedSupplierType === LOGISTICS_SUPPLIER_TYPE_CODE
    ? supplierTypeStorageValue(requestedSupplierType)
    : "其他供应商";
  const allowDomesticLogisticsEntry = booleanInput(input.allowDomesticLogisticsEntry, before?.allowDomesticLogisticsEntry || false);
  const allowLogisticsExpenseEntry = booleanInput(input.allowLogisticsExpenseEntry, before?.allowLogisticsExpenseEntry || false);
  const allowLogisticsInvoiceUpload = booleanInput(input.allowLogisticsInvoiceUpload, before?.allowLogisticsInvoiceUpload || false);
  const allowFactoryDocumentUpload = booleanInput(input.allowFactoryDocumentUpload, before?.allowFactoryDocumentUpload || false);
  const requestedDispatchSmsEnabled = booleanInput(
    input.dispatchSmsEnabled,
    before?.dispatchSmsEnabled || false,
  );
  const isDefaultLogisticsSupplier = booleanInput(input.isDefaultLogisticsSupplier, before?.isDefaultLogisticsSupplier || false);
  const isLogisticsSupplierType = DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplierType);
  const isProductSupplierType = PRODUCT_SUPPLIER_TYPES.includes(supplierType);
  const rawDispatchSmsPhone = Object.prototype.hasOwnProperty.call(input, "dispatchSmsPhone")
    ? optional(input.dispatchSmsPhone)
    : before?.dispatchSmsPhone || null;
  const dispatchSmsPhone = rawDispatchSmsPhone
    ? normalizeChinaMobilePhone(rawDispatchSmsPhone)
    : null;
  if (rawDispatchSmsPhone && !dispatchSmsPhone) {
    throw codedError(
      "采购通知手机号必须是有效的中国大陆手机号码。",
      400,
      "SUPPLIER_DISPATCH_SMS_PHONE_INVALID",
    );
  }
  if (requestedDispatchSmsEnabled && !isProductSupplierType) {
    throw codedError(
      "只有产品供应商可以启用采购订单短信通知。",
      400,
      "SUPPLIER_DISPATCH_SMS_TYPE_INVALID",
    );
  }
  if (requestedDispatchSmsEnabled && !dispatchSmsPhone) {
    throw codedError(
      "启用采购订单短信通知前，请填写有效的中国大陆手机号。",
      400,
      "SUPPLIER_DISPATCH_SMS_PHONE_REQUIRED",
    );
  }
  const dispatchSmsEnabled = isProductSupplierType && requestedDispatchSmsEnabled;
  const allowedLogisticsCostTypes = normalizeLogisticsCostTypeList(
    Array.isArray(input.allowedLogisticsCostTypes)
      ? input.allowedLogisticsCostTypes
      : (Array.isArray(before?.allowedLogisticsCostTypes) ? before.allowedLogisticsCostTypes : []),
  );
  if (isLogisticsSupplierType && allowLogisticsExpenseEntry && !allowedLogisticsCostTypes.length) {
    throw codedError("请至少配置一个允许录入的物流费用类型。", 400, "LOGISTICS_COST_TYPES_REQUIRED");
  }
  const purchasePaymentTerm = Object.prototype.hasOwnProperty.call(input, "purchasePaymentTerm")
    ? optional(input.purchasePaymentTerm)
    : before?.purchasePaymentTerm || null;
  if ((purchasePaymentTerm || "").length > 500) {
    throw codedError("采购付款条款不能超过 500 个字符", 400, "SUPPLIER_PURCHASE_PAYMENT_TERM_TOO_LONG");
  }
  const currentPrepaymentPercent = new Prisma.Decimal(before?.purchasePrepaymentRatio || 0).mul(100).toString();
  const purchasePrepaymentPercent = Object.prototype.hasOwnProperty.call(input, "purchasePrepaymentPercent")
    ? String(input.purchasePrepaymentPercent ?? "").trim()
    : currentPrepaymentPercent;
  if (!/^(?:0|[1-9]\d?)(?:\.\d{1,4})?$|^100(?:\.0{1,4})?$/.test(purchasePrepaymentPercent)) {
    throw codedError("采购预付款比例必须是 0 到 100 之间的数字", 400, "SUPPLIER_PURCHASE_PREPAYMENT_PERCENT_INVALID");
  }
  const purchasePrepaymentRatio = new Prisma.Decimal(purchasePrepaymentPercent).div(100);
  const purchasePrepaymentRequiredBeforeProduction = purchasePrepaymentRatio.gt(0) && booleanInput(
    input.purchasePrepaymentRequiredBeforeProduction,
    before?.purchasePrepaymentRequiredBeforeProduction || false,
  );
  const currentTolerancePercent = new Prisma.Decimal(
    before?.purchaseQuantityToleranceRatio ?? "0.05",
  ).mul(100).toString();
  const purchaseQuantityTolerancePercent = isProductSupplierType
    ? Object.prototype.hasOwnProperty.call(input, "purchaseQuantityTolerancePercent")
      ? String(input.purchaseQuantityTolerancePercent ?? "").trim()
      : currentTolerancePercent
    : "0";
  if (!/^(?:[0-4](?:\.\d{1,4})?|5(?:\.0{1,4})?)$/.test(purchaseQuantityTolerancePercent)) {
    throw codedError(
      "采购数量公差必须是 0 到 5 之间的数字",
      400,
      "SUPPLIER_PURCHASE_QUANTITY_TOLERANCE_PERCENT_INVALID",
    );
  }
  const purchaseQuantityToleranceRatio = new Prisma.Decimal(
    purchaseQuantityTolerancePercent,
  ).div(100);
  const activeDefaultLogisticsSupplier = isLogisticsSupplierType && isDefaultLogisticsSupplier;
  const data = {
    supplierName,
    supplierType,
    country: optional(input.country),
    contactPerson: optional(input.contactPerson),
    phone: optional(input.phone),
    email: optional(input.email),
    address: optional(input.address),
    invoiceTitle: optional(input.invoiceTitle),
    taxNumber: optional(input.taxNumber),
    bankName: optional(input.bankName),
    bankAccount: optional(input.bankAccount),
    purchasePaymentTerm,
    purchasePrepaymentRatio,
    purchasePrepaymentRequiredBeforeProduction,
    purchaseQuantityToleranceRatio,
    remark: optional(input.remark),
    status: SUPPLIER_STATUSES.includes(nonEmpty(input.status)) ? nonEmpty(input.status) : "启用",
    allowDomesticLogisticsEntry,
    allowLogisticsExpenseEntry,
    allowLogisticsInvoiceUpload,
    allowFactoryDocumentUpload,
    dispatchSmsEnabled,
    dispatchSmsPhone,
    isDefaultLogisticsSupplier,
    allowedLogisticsCostTypes,
    updatedById: actorId,
    ...(id ? {} : { createdById: actorId }),
  };
  const supplier = await prisma.$transaction(async (tx) => {
    if (activeDefaultLogisticsSupplier) {
      await tx.supplier.updateMany({
        where: { isDefaultLogisticsSupplier: true, ...(id ? { NOT: { id } } : {}) },
        data: { isDefaultLogisticsSupplier: false },
      });
    }
    return id
      ? tx.supplier.update({ where: { id }, data, include: { createdBy: true, updatedBy: true } })
      : tx.supplier.create({ data, include: { createdBy: true, updatedBy: true } });
  });
  await runNonCriticalTask("供应商操作日志写入", () => writeAudit(request, actor, id ? "更新供应商" : "新增供应商", "suppliers", supplier.id, before, supplier));
  return serializeSupplier(supplier);
}

export async function deleteSupplier(request: AuditRequestLike, actor: ActorLike, id: string) {
  assertWrite(actor, "suppliers");
  const actorId = requireText(actor?.id, "当前用户");
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) {
    throw codedError("供应商不存在或已删除", 404, "SUPPLIER_NOT_FOUND");
  }
  const costCount = await prisma.orderCost.count({ where: { supplierId: id, deletedAt: null } });
  if (costCount > 0) {
    throw codedError("该供应商已有成本记录，不能删除，只能停用。", 400, "SUPPLIER_HAS_COSTS");
  }
  const row = await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actorId } });
  await runNonCriticalTask("供应商删除操作日志写入", () => writeAudit(request, actor, "删除供应商", "suppliers", id, before, row));
}
