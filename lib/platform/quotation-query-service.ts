import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma";
import {
  assertRead,
  codedError,
  effectivePermissions,
  pageParams,
  pageResult,
} from "./shared";
import { serializeQuotation, type QuotationActor } from "./quotation-values";
import { quotationOwnershipWhere } from "./quotation-calculations";

type QueryLike = { get(key: string): string | null };
export type QuotationClient = Prisma.TransactionClient | typeof prisma;

export const quotationCustomerSelect = {
  id: true,
  name: true,
  shortName: true,
  country: true,
  defaultCurrency: true,
  salespersonUserId: true,
  contactPerson: true,
  contactEmail: true,
  contactPhone: true,
  shippingDocsEmails: true,
  shippingDocsCcEmails: true,
} satisfies Prisma.CustomerSelect;

const quotationUserSelect = {
  id: true,
  name: true,
} satisfies Prisma.UserSelect;

const quotationListInclude = {
  customer: { select: quotationCustomerSelect },
  businessEntity: true,
  salesperson: { select: quotationUserSelect },
  versions: {
    orderBy: [{ versionNumber: "desc" as const }],
    take: 1,
  },
} satisfies Prisma.SalesQuotationInclude;

const quotationDetailInclude = {
  customer: { select: quotationCustomerSelect },
  businessEntity: true,
  salesperson: { select: quotationUserSelect },
  salesExecution: { select: { id: true, customerOrderNo: true, status: true } },
  versions: {
    orderBy: [{ versionNumber: "desc" as const }],
    include: { items: { orderBy: [{ lineNumber: "asc" as const }] } },
  },
  deliveries: {
    orderBy: [{ createdAt: "desc" as const }],
    include: {
      sentBy: { select: quotationUserSelect },
    },
  },
  decisions: {
    orderBy: [{ createdAt: "desc" as const }],
    include: {
      recordedBy: { select: quotationUserSelect },
    },
  },
} satisfies Prisma.SalesQuotationInclude;

export function quotationAccessWhere(actor: QuotationActor): Prisma.SalesQuotationWhereInput {
  const permissions = effectivePermissions(actor);
  return quotationOwnershipWhere(permissions.dataScope, actor?.id);
}

function quotationStatus(value: unknown) {
  const status = String(value || "").trim().toUpperCase();
  if (!status) return null;
  if (!(["DRAFT", "SENT", "ACCEPTED", "REJECTED", "VOIDED"] as string[]).includes(status)) {
    throw codedError("报价状态筛选值无效", 400, "QUOTATION_STATUS_INVALID");
  }
  return status as "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "VOIDED";
}

export async function listQuotations(query: QueryLike, actor: QuotationActor) {
  assertRead(actor, "quotations");
  const { page, pageSize } = pageParams(query, 20, 100);
  const keyword = String(query.get("keyword") || query.get("q") || "").trim();
  const customerId = String(query.get("customerId") || "").trim();
  const status = quotationStatus(query.get("status"));
  const where: Prisma.SalesQuotationWhereInput = {
    ...quotationAccessWhere(actor),
    ...(customerId ? { customerId } : {}),
    ...(status ? { status } : {}),
    ...(keyword ? {
      OR: [
        { quoteNo: { contains: keyword, mode: "insensitive" } },
        { invoiceNo: { contains: keyword, mode: "insensitive" } },
        { customer: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { customer: { is: { shortName: { contains: keyword, mode: "insensitive" } } } },
        { salesperson: { is: { name: { contains: keyword, mode: "insensitive" } } } },
        { versions: { some: { items: { some: { productNameSnapshot: { contains: keyword, mode: "insensitive" } } } } } },
      ],
    } : {}),
  };
  const [total, quotations] = await Promise.all([
    prisma.salesQuotation.count({ where }),
    prisma.salesQuotation.findMany({
      where,
      include: quotationListInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return pageResult(quotations.map((row) => serializeQuotation(row)), total, page, pageSize);
}

export async function loadQuotation(id: string, actor: QuotationActor, client: QuotationClient) {
  const quotation = await client.salesQuotation.findFirst({
    where: { id, ...quotationAccessWhere(actor) },
    include: quotationDetailInclude,
  });
  if (!quotation) throw codedError("报价不存在或无权访问", 404, "QUOTATION_NOT_FOUND");
  return quotation;
}

export async function getQuotation(id: string, actor: QuotationActor) {
  assertRead(actor, "quotations");
  const canReadSalesExecution = Boolean(effectivePermissions(actor).reads.salesExecution);
  return serializeQuotation(await loadQuotation(id, actor, prisma), true, canReadSalesExecution);
}
