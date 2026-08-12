import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  CURRENCIES,
  assertCustomerScope,
  assertJsonObject,
  canRead,
  canWrite,
  codedError,
  pageParams,
  pageResult,
  writeAudit,
} from "./shared";
import {
  productIdentityKey,
  productFingerprint,
  quotationText,
  serializeCustomerProduct,
  type QuotationActor,
} from "./quotation-values";

type QueryLike = { get(key: string): string | null };
type AuditRequest = Parameters<typeof writeAudit>[0];

function assertCustomerProductRead(actor: QuotationActor) {
  if (!canRead(actor, "quotations") && !canRead(actor, "salesExecution")) {
    throw codedError("没有权限查看客户产品", 403, "PERMISSION_DENIED");
  }
}

function assertCustomerProductWrite(actor: QuotationActor) {
  if (!canWrite(actor, "quotations") && !canWrite(actor, "salesExecution")) {
    throw codedError("没有权限维护客户产品", 403, "PERMISSION_DENIED");
  }
}

async function findIdentityProduct(
  client: Prisma.TransactionClient,
  customerId: string,
  data: { name: string; specification: string | null; unit: string },
  exceptId = "",
) {
  const identityKey = productIdentityKey(customerId, data.name, data.specification, data.unit);
  const candidates = await client.customerProduct.findMany({
    where: { customerId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  return candidates.find((product) => (
    productIdentityKey(customerId, product.name, product.specification, product.unit) === identityKey
  )) || null;
}

function requireActorId(actor: QuotationActor) {
  const id = String(actor?.id || "").trim();
  if (!id) throw codedError("请先登录", 401, "AUTH_REQUIRED");
  return id;
}

async function loadCustomerProduct(id: string, actor: QuotationActor) {
  const product = await prisma.customerProduct.findFirst({
    where: { id, deletedAt: null },
  });
  if (!product) throw codedError("客户产品不存在或已删除", 404, "CUSTOMER_PRODUCT_NOT_FOUND");
  await assertCustomerScope(actor, product.customerId);
  return product;
}

export async function listCustomerProducts(query: QueryLike, actor: QuotationActor) {
  assertCustomerProductRead(actor);
  const customerId = String(query.get("customerId") || "").trim();
  if (!customerId) throw codedError("请选择客户", 400, "CUSTOMER_REQUIRED");
  await assertCustomerScope(actor, customerId);
  const keyword = String(query.get("keyword") || query.get("q") || "").trim();
  const currency = String(query.get("currency") || "").trim().toUpperCase();
  if (currency && !CURRENCIES.includes(currency)) {
    throw codedError("请选择有效币种", 400, "QUOTATION_CURRENCY_INVALID");
  }
  const { page, pageSize } = pageParams(query, 20, 100);
  const where: Prisma.CustomerProductWhereInput = {
    customerId,
    deletedAt: null,
    ...(keyword ? {
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { specification: { contains: keyword, mode: "insensitive" } },
        { unit: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [total, products] = await Promise.all([
    prisma.customerProduct.count({ where }),
    prisma.customerProduct.findMany({
      where,
      include: {
        quoteItems: {
          where: {
            ...(currency ? { currencySnapshot: currency } : {}),
            quotationVersion: {
              sealedAt: { not: null },
              quotation: { status: { in: ["DRAFT", "SENT", "ACCEPTED", "REJECTED"] } },
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
        salesExecutionItems: {
          where: {
            ...(currency ? { currencySnapshot: currency } : {}),
            execution: { status: { in: ["DRAFT", "DISPATCHED"] } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return pageResult(products.map(serializeCustomerProduct), total, page, pageSize);
}

function customerProductData(input: Record<string, unknown>, customerId: string, actorId: string) {
  const name = quotationText(input.name ?? input.productName, "品名", 200, true);
  const specification = quotationText(input.specification, "规格", 500);
  const unit = quotationText(input.unit, "单位", 50, true);
  return {
    customerId,
    name,
    specification: specification || null,
    unit,
    fingerprint: productFingerprint(customerId, name, specification, unit),
    remark: quotationText(input.remark, "备注", 2000) || null,
    updatedById: actorId,
  };
}

export async function saveCustomerProduct(
  request: AuditRequest,
  actor: QuotationActor,
  input: unknown,
  id: string | null = null,
) {
  assertCustomerProductWrite(actor);
  const actorId = requireActorId(actor);
  const body = assertJsonObject(input);
  const before = id ? await loadCustomerProduct(id, actor) : null;
  const customerId = before?.customerId || String(body.customerId || "").trim();
  if (!customerId) throw codedError("请选择客户", 400, "CUSTOMER_REQUIRED");
  if (before && Object.hasOwn(body, "customerId") && String(body.customerId || "").trim() !== before.customerId) {
    throw codedError("客户产品不能转移到其他客户", 400, "CUSTOMER_PRODUCT_CUSTOMER_IMMUTABLE");
  }
  await assertCustomerScope(actor, customerId);
  const mergedBody = before ? {
    name: Object.hasOwn(body, "name") || Object.hasOwn(body, "productName")
      ? (body.name ?? body.productName)
      : before.name,
    specification: Object.hasOwn(body, "specification") ? body.specification : before.specification,
    unit: Object.hasOwn(body, "unit") ? body.unit : before.unit,
    remark: Object.hasOwn(body, "remark") ? body.remark : before.remark,
  } : body;
  const data = customerProductData(mergedBody, customerId, actorId);

  try {
    return await prisma.$transaction(async (tx) => {
      if (before) {
        const duplicate = await findIdentityProduct(tx, customerId, data, before.id);
        if (duplicate) throw codedError("该客户已存在相同品名、规格和单位的产品", 409, "CUSTOMER_PRODUCT_DUPLICATE");
        const product = await tx.customerProduct.update({ where: { id: before.id }, data });
        await writeAudit(request, { id: actorId }, "更新客户产品", "customer_products", product.id, before, product, tx);
        return serializeCustomerProduct(product);
      }

      const existing = await findIdentityProduct(tx, customerId, data)
        || await tx.customerProduct.findUnique({
          where: { customerId_fingerprint: { customerId, fingerprint: data.fingerprint } },
        });
      if (existing && !existing.deletedAt) {
        throw codedError("该客户已存在相同品名、规格和单位的产品", 409, "CUSTOMER_PRODUCT_DUPLICATE");
      }
      const product = existing
        ? await tx.customerProduct.update({
            where: { id: existing.id },
            data: { ...data, fingerprint: existing.fingerprint, deletedAt: null },
          })
        : await tx.customerProduct.create({
            data: { ...data, createdById: actorId },
          });
      await writeAudit(
        request,
        { id: actorId },
        existing ? "恢复客户产品" : "新增客户产品",
        "customer_products",
        product.id,
        existing,
        product,
        tx,
      );
      return serializeCustomerProduct(product);
    });
  } catch (error: unknown) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      throw codedError("该客户已存在相同品名、规格和单位的产品", 409, "CUSTOMER_PRODUCT_DUPLICATE");
    }
    throw error;
  }
}

export async function voidCustomerProduct(request: AuditRequest, actor: QuotationActor, id: string) {
  assertCustomerProductWrite(actor);
  const actorId = requireActorId(actor);
  const before = await loadCustomerProduct(id, actor);
  return prisma.$transaction(async (tx) => {
    const product = await tx.customerProduct.update({
      where: { id: before.id },
      data: { deletedAt: new Date(), updatedById: actorId },
    });
    await writeAudit(request, { id: actorId }, "作废客户产品", "customer_products", product.id, before, product, tx);
    return serializeCustomerProduct(product);
  });
}
