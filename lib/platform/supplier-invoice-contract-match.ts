import { Prisma } from "../generated/prisma/client.js";
import type { SupplierTaxContractDraft } from "./supplier-tax-contract-draft";
import type { recognizeTencentVatInvoice } from "./tencent-vat-invoice-ocr";

type VatInvoiceResult = Awaited<ReturnType<typeof recognizeTencentVatInvoice>>;

function text(value: unknown) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function productName(value: unknown) {
  return text(value).replace(/^\*[^*]+\*/, "");
}

function decimal(value: unknown) {
  const normalized = String(value || "").replace(/[￥¥,，\s]/g, "");
  try {
    return new Prisma.Decimal(normalized || "0");
  } catch {
    return null;
  }
}

function lineGrossAmount(line: { amountWithTax?: unknown; amountWithoutTax?: unknown; taxAmount?: unknown }) {
  if (String(line.amountWithTax ?? "").trim()) return decimal(line.amountWithTax);
  if (!String(line.amountWithoutTax ?? "").trim() || !String(line.taxAmount ?? "").trim()) return null;
  const amountWithoutTax = decimal(line.amountWithoutTax);
  const taxAmount = decimal(line.taxAmount);
  return amountWithoutTax && taxAmount ? amountWithoutTax.add(taxAmount).toDecimalPlaces(2) : null;
}

function aggregate(lines: Array<{
  name?: unknown;
  unit?: unknown;
  quantity?: unknown;
  amountWithTax?: unknown;
  amountWithoutTax?: unknown;
  taxAmount?: unknown;
}>) {
  const map = new Map<string, { quantity: Prisma.Decimal; grossAmount: Prisma.Decimal | null }>();
  for (const line of lines) {
    const key = `${productName(line.name)}|${text(line.unit)}`;
    const quantity = decimal(line.quantity);
    if (!productName(line.name) || !text(line.unit) || !quantity) continue;
    const grossAmount = lineGrossAmount(line);
    const previous = map.get(key);
    map.set(key, {
      quantity: (previous?.quantity || new Prisma.Decimal(0)).add(quantity),
      grossAmount: previous?.grossAmount === null || grossAmount === null
        ? null
        : (previous?.grossAmount || new Prisma.Decimal(0)).add(grossAmount).toDecimalPlaces(2),
    });
  }
  return map;
}

export function matchSupplierInvoiceToContract(invoice: VatInvoiceResult, contract: SupplierTaxContractDraft) {
  const issues: string[] = [];
  const header = invoice.header;
  if (invoice.pageCount > 1) issues.push("当前只允许单张发票PDF，请拆分后分别上传");
  if (!text(header.invoiceName).includes("增值税")) issues.push("上传文件不是可识别的增值税发票");
  if (!header.invoiceNo) issues.push("未识别到发票号码");
  if (text(header.sellerName) !== text(contract.supplierName)) issues.push("销售方名称与合同供方不一致");
  if (!contract.supplierTaxNumber || text(header.sellerTaxNo) !== text(contract.supplierTaxNumber)) issues.push("销售方纳税人识别号与供应商资料不一致");
  if (text(header.buyerName) !== text(contract.buyerName)) issues.push("购买方名称与合同需方不一致");
  if (!contract.buyerTaxNumber || text(header.buyerTaxNo) !== text(contract.buyerTaxNumber)) issues.push("购买方纳税人识别号与业务主体不一致");
  const invoiceTotal = decimal(header.amountWithTax);
  const contractTotal = decimal(contract.totalAmountWithTax);
  if (!invoiceTotal || !contractTotal || !invoiceTotal.eq(contractTotal)) issues.push("发票价税合计与合同总金额不一致");
  const invoiceLines = aggregate(invoice.items);
  const contractLines = aggregate(contract.items.map((item) => ({
    name: item.productName,
    unit: item.unit,
    quantity: item.quantity,
    amountWithTax: item.amountWithTax,
  })));
  if (invoiceLines.size !== contractLines.size) issues.push("发票商品行与合同商品行数量不一致");
  for (const [key, expected] of contractLines) {
    const actual = invoiceLines.get(key);
    const [name, unit] = key.split("|");
    if (!actual) issues.push(`发票缺少合同商品：${name}（${unit}）`);
    else {
      if (!actual.quantity.eq(expected.quantity)) {
        issues.push(`商品${name}的发票数量${actual.quantity.toString()}与合同数量${expected.quantity.toString()}不一致`);
      }
      if (actual.grossAmount === null) issues.push(`商品${name}未完整识别到发票金额和税额`);
      else if (expected.grossAmount === null || !actual.grossAmount.eq(expected.grossAmount)) {
        issues.push(`商品${name}的发票价税金额${actual.grossAmount.toString()}与合同含税金额${expected.grossAmount?.toString() || "-"}不一致`);
      }
    }
  }
  for (const key of invoiceLines.keys()) {
    if (!contractLines.has(key)) issues.push(`发票存在合同外商品：${key.split("|")[0]}`);
  }
  return {
    matched: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString(),
    contractNo: contract.contractNo,
    invoice: {
      provider: invoice.provider,
      apiName: invoice.apiName,
      requestId: invoice.requestId,
      header,
      items: invoice.items,
    },
  };
}
