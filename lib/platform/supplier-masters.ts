// @ts-nocheck
import { prisma } from "../prisma";
import {
  DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
  LOGISTICS_OPERATOR_ROLE,
  SUPPLIER_STATUSES,
  SUPPLIER_TYPES,
  assertRead,
  assertWrite,
  booleanInput,
  canRead,
  canWrite,
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
  writeAudit,
} from "./shared";
import { effectivePermissions } from "./shared-permissions";
import {
  isExternalLogisticsSupplierAccount,
  isInternalLogisticsOperator,
} from "./masters-access";

export async function listSuppliers(query, actor = null, onlyActive = false, options = {}) {
  if (!onlyActive) {
    assertRead(actor, "suppliers");
  } else if (!canRead(actor, "suppliers") && !canWrite(actor, "costs") && !canWrite(actor, "logistics") && !canWrite(actor, "domesticLogistics")) {
    throw permissionError("没有权限搜索供应商");
  }
  const keyword = nonEmpty(query?.get("q") || query?.get("keyword") || query?.get("party"));
  const typeText = nonEmpty(query?.get("type") || query?.get("supplierType"));
  const statusText = nonEmpty(query?.get("status"));
  const typeMap = {
    factory: "工厂供应商",
    logistics: "物流供应商",
    logisticsfee: DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    "logistics-fee": DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    logistics_fee: DOMESTIC_LOGISTICS_SUPPLIER_TYPES,
    customs: "报关供应商",
    ocean: "海运供应商",
    shipping: "海运供应商",
    other: "其他供应商",
  };
  const statusMap = { active: "启用", enabled: "启用", inactive: "停用", disabled: "停用" };
  const supplierType = typeText ? (typeMap[typeText.toLowerCase()] || typeText) : "";
  const requestedStatus = statusText ? (statusMap[statusText.toLowerCase()] || statusText) : "";
  const supplierScope = isExternalLogisticsSupplierAccount(actor)
    ? { id: actor.supplierId }
    : (actor?.role === LOGISTICS_OPERATOR_ROLE ? { id: "__no_supplier_bound__" } : {});
  const where = {
    deletedAt: null,
    ...supplierScope,
    ...((onlyActive || actor?.role !== "管理员")
      ? { status: "启用" }
      : (SUPPLIER_STATUSES.includes(requestedStatus) ? { status: requestedStatus } : {})),
    ...(Array.isArray(supplierType)
      ? { supplierType: { in: supplierType } }
      : (supplierType && SUPPLIER_TYPES.includes(supplierType) ? { supplierType } : {})),
    ...(keyword ? {
      OR: [
        { supplierName: { contains: keyword, mode: "insensitive" } },
        { invoiceTitle: { contains: keyword, mode: "insensitive" } },
        { contactPerson: { contains: keyword, mode: "insensitive" } },
        { supplierType: { contains: keyword, mode: "insensitive" } },
        { taxNumber: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
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

export async function listAvailableSuppliers(query, actor) {
  return listSuppliers(query, actor, true);
}

export async function assertSupplierActive(supplierId) {
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

export async function saveSupplier(request, actor, input, id = null) {
  assertWrite(actor, "suppliers");
  const supplierName = requireText(input.supplierName || input.name, "供应商名称");
  const before = id
    ? await prisma.supplier.findFirst({ where: { id, deletedAt: null }, include: { createdBy: true, updatedBy: true } })
    : null;
  if (id && !before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const duplicate = await prisma.supplier.findFirst({
    where: {
      supplierName: { equals: supplierName, mode: "insensitive" },
      deletedAt: null,
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (duplicate) {
    const error = new Error("供应商名称已存在，不能重复创建");
    error.status = 409;
    throw error;
  }
  const supplierType = SUPPLIER_TYPES.includes(input.supplierType) ? input.supplierType : "其他供应商";
  const allowDomesticLogisticsEntry = booleanInput(input.allowDomesticLogisticsEntry, before?.allowDomesticLogisticsEntry || false);
  const allowLogisticsExpenseEntry = booleanInput(input.allowLogisticsExpenseEntry, before?.allowLogisticsExpenseEntry || false);
  const allowLogisticsInvoiceUpload = booleanInput(input.allowLogisticsInvoiceUpload, before?.allowLogisticsInvoiceUpload || false);
  const isDefaultLogisticsSupplier = booleanInput(input.isDefaultLogisticsSupplier, before?.isDefaultLogisticsSupplier || false);
  const allowedLogisticsCostTypes = normalizeLogisticsCostTypeList(input.allowedLogisticsCostTypes ?? before?.allowedLogisticsCostTypes ?? []);
  if (allowDomesticLogisticsEntry && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplierType)) {
    throw codedError("只有物流、报关、海运、港杂费用供应商可以开启物流信息录入。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  }
  if ((allowLogisticsExpenseEntry || allowLogisticsInvoiceUpload) && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplierType)) {
    throw codedError("只有物流、报关、海运、港杂费用供应商可以开启物流费用协同权限。", 400, "SUPPLIER_TYPE_NOT_ALLOWED");
  }
  if (allowLogisticsExpenseEntry && !allowedLogisticsCostTypes.length) {
    throw codedError("请至少配置一个允许录入的物流费用类型。", 400, "LOGISTICS_COST_TYPES_REQUIRED");
  }
  if (isDefaultLogisticsSupplier && !DOMESTIC_LOGISTICS_SUPPLIER_TYPES.includes(supplierType)) {
    throw codedError("默认物流供应商只能设置为物流、报关、海运或港杂费用供应商。", 400, "DEFAULT_LOGISTICS_SUPPLIER_TYPE_INVALID");
  }
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
    remark: optional(input.remark),
    status: SUPPLIER_STATUSES.includes(input.status) ? input.status : "启用",
    allowDomesticLogisticsEntry,
    allowLogisticsExpenseEntry,
    allowLogisticsInvoiceUpload,
    isDefaultLogisticsSupplier,
    allowedLogisticsCostTypes,
    updatedById: actor.id,
    ...(id ? {} : { createdById: actor.id }),
  };
  const supplier = await prisma.$transaction(async (tx) => {
    if (isDefaultLogisticsSupplier) {
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

export async function deleteSupplier(request, actor, id) {
  assertWrite(actor, "suppliers");
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) {
    const error = new Error("供应商不存在或已删除");
    error.status = 404;
    throw error;
  }
  const costCount = await prisma.orderCost.count({ where: { supplierId: id, deletedAt: null } });
  if (costCount > 0) {
    const error = new Error("该供应商已有成本记录，不能删除，只能停用。");
    error.status = 400;
    throw error;
  }
  const row = await prisma.supplier.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.id } });
  await runNonCriticalTask("供应商删除操作日志写入", () => writeAudit(request, actor, "删除供应商", "suppliers", id, before, row));
}
