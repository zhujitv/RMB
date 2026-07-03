import { prisma } from "../prisma";
import type { Prisma } from "../generated/prisma/client.js";
import { assertRead, assertWrite, permissionError } from "./shared-access";
import { codedError, nonEmpty, num, runNonCriticalTask } from "./shared";
import { writeAudit } from "./shared-audit";
import { assertTaxRefundFeatureEnabled } from "./tax-refund-features";

type ActorLike = { id?: string | null; role?: string | null } | null | undefined;
type AuditRequestLike = Parameters<typeof writeAudit>[0];

const RATE_MAX_PERCENT = 13;

function cleanText(value: unknown) {
  return String(value || "").replace(/\u3000/g, " ").replace(/[ \t]+/g, " ").trim();
}

function normalizeHsCode(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

function validateHsCode(value: unknown) {
  const hsCode = normalizeHsCode(value);
  if (!/^\d{10}$/.test(hsCode)) throw codedError("HS编码必须是10位数字。", 400, "INVALID_HS_CODE");
  return hsCode;
}

function rateDecimalFromPercent(value: unknown, label: string, required = true) {
  const rawText = cleanText(value);
  if (!rawText && !required) return null;
  if (!rawText && required) throw codedError(`${label}必填。`, 400, "INVALID_HS_RATE");
  const parsed = Number(rawText);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > RATE_MAX_PERCENT) {
    throw codedError(`${label}必须为0-13之间的数字。`, 400, "INVALID_HS_RATE");
  }
  return parsed / 100;
}

function ratePercent(value: unknown) {
  return Number((num(value, 0) * 100).toFixed(4));
}

function serializeCompanyHs(row: Prisma.CompanyHsGetPayload<{}>) {
  return {
    id: row.id,
    hsCode: row.hsCode,
    cnName: row.cnName,
    enName: row.enName || "",
    unit: row.unit,
    rebateRate: ratePercent(row.rebateRate),
    vatRate: ratePercent(row.vatRate),
    keywords: row.keywords || "",
    remark: row.remark || "",
    isEnabled: Boolean(row.isEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function companyHsData(input: Record<string, unknown>, partial = false) {
  const data: Record<string, unknown> = {};
  if (!partial || "hsCode" in input) data.hsCode = validateHsCode(input.hsCode);
  if (!partial || "cnName" in input) {
    const cnName = cleanText(input.cnName);
    if (!cnName) throw codedError("中文报关名称必填。", 400, "COMPANY_HS_CN_NAME_REQUIRED");
    data.cnName = cnName;
  }
  if (!partial || "unit" in input) {
    const unit = cleanText(input.unit);
    if (!unit) throw codedError("法定单位必填。", 400, "COMPANY_HS_UNIT_REQUIRED");
    data.unit = unit;
  }
  if (!partial || "rebateRate" in input) data.rebateRate = rateDecimalFromPercent(input.rebateRate, "出口退税率") as number;
  if (!partial || "vatRate" in input) data.vatRate = rateDecimalFromPercent(input.vatRate ?? RATE_MAX_PERCENT, "增值税率") as number;
  if ("enName" in input) data.enName = cleanText(input.enName) || null;
  if ("keywords" in input) data.keywords = cleanText(input.keywords) || null;
  if ("remark" in input) data.remark = cleanText(input.remark) || null;
  if ("isEnabled" in input) data.isEnabled = input.isEnabled !== false;
  return data;
}

export async function findCompanyHsForCalculation(hsCode: string) {
  const code = normalizeHsCode(hsCode);
  if (!code) return null;
  return prisma.companyHs.findFirst({
    where: { hsCode: code, deletedAt: null, isEnabled: true },
    orderBy: [{ updatedAt: "desc" }],
  });
}

export async function listCompanyHs(query: URLSearchParams, actor: ActorLike) {
  await assertTaxRefundFeatureEnabled("companyHsLibraryEnabled", "企业HS编码库功能已关闭。");
  assertRead(actor, "companyHs");
  const keyword = cleanText(query.get("keyword"));
  const includeDisabled = query.get("includeDisabled") === "1";
  const where: Prisma.CompanyHsWhereInput = {
    deletedAt: null,
    ...(includeDisabled ? {} : { isEnabled: true }),
    ...(keyword ? {
      OR: [
        { hsCode: { contains: keyword, mode: "insensitive" } },
        { cnName: { contains: keyword, mode: "insensitive" } },
        { enName: { contains: keyword, mode: "insensitive" } },
        { keywords: { contains: keyword, mode: "insensitive" } },
      ],
    } : {}),
  };
  const rows = await prisma.companyHs.findMany({
    where,
    orderBy: [{ isEnabled: "desc" }, { hsCode: "asc" }],
    take: 200,
  });
  return rows.map(serializeCompanyHs);
}

export async function saveCompanyHs(request: AuditRequestLike, actor: ActorLike, input: Record<string, unknown>, id?: string | null) {
  await assertTaxRefundFeatureEnabled("companyHsLibraryEnabled", "企业HS编码库功能已关闭。");
  assertWrite(actor, "companyHs");
  const actorId = nonEmpty(actor?.id);
  if (!actorId) throw permissionError("请先登录", 401);
  const before = id
    ? await prisma.companyHs.findFirst({ where: { id, deletedAt: null } })
    : null;
  if (id && !before) throw codedError("企业HS编码不存在或已停用。", 404, "COMPANY_HS_NOT_FOUND");
  const data = companyHsData(input, Boolean(id));
  const row = id
    ? await prisma.companyHs.update({ where: { id }, data: data as Prisma.CompanyHsUncheckedUpdateInput })
    : await prisma.companyHs.create({ data: data as Prisma.CompanyHsUncheckedCreateInput });
  await runNonCriticalTask("企业HS编码操作日志写入", () => writeAudit(
    request,
    actor,
    id ? "编辑HS编码" : "新增HS编码",
    "company_hs",
    row.id,
    before,
    row,
  ));
  return serializeCompanyHs(row);
}

export async function disableCompanyHs(request: AuditRequestLike, actor: ActorLike, id: string) {
  await assertTaxRefundFeatureEnabled("companyHsLibraryEnabled", "企业HS编码库功能已关闭。");
  assertWrite(actor, "companyHs");
  const before = await prisma.companyHs.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw codedError("企业HS编码不存在或已停用。", 404, "COMPANY_HS_NOT_FOUND");
  const row = await prisma.companyHs.update({
    where: { id },
    data: { isEnabled: false, deletedAt: new Date() },
  });
  await runNonCriticalTask("企业HS编码停用日志写入", () => writeAudit(request, actor, "停用HS编码", "company_hs", id, before, row));
  return serializeCompanyHs(row);
}

export async function createCompanyHsFromDeclarationItem(
  request: AuditRequestLike,
  actor: ActorLike,
  orderId: string,
  input: Record<string, unknown>,
) {
  void request;
  void actor;
  void orderId;
  void input;
  throw codedError("退税资料 OCR 加入企业HS功能已停用，请在企业HS编码模块手工维护。", 410, "TAX_REFUND_OCR_CALC_DISABLED");
}
