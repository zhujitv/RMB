import { safeFileName } from "../r2";
import { addDays, codedError, dateFromInput as sharedDateFromInput, dateToInput, nonEmpty, todayInputInChina } from "./shared";
import {
  EXCEL_TEMPLATE_MIME,
  LEGACY_EXCEL_TEMPLATE_MIME,
  MAX_EXCEL_TEMPLATE_BYTES,
  type ExcelUploadFile,
} from "./supplier-document-request-types";
import { supplierDocumentEmailLabel } from "./supplier-document-request-payment";

export function dateFromInput(value: unknown) {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(`${text.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw codedError("截止日期格式错误", 400, "INVALID_DUE_DATE");
  }
  return date;
}

export function defaultSupplierDocumentRequestDueDate(now = todayInputInChina()) {
  return addDays(sharedDateFromInput(now), 3);
}

export function supplierDocumentRequestTemplateVariables({
  supplierName,
  orderNo,
  requiredTypes,
  dueDate,
  templateAttached,
  paymentVoucherAttached,
  companyName,
  message,
}: {
  supplierName: string;
  orderNo: string;
  requiredTypes: string[];
  dueDate: Date | null;
  templateAttached: boolean;
  paymentVoucherAttached: boolean;
  companyName: string;
  message?: string | null;
}) {
  const documentLines = requiredTypes.map((type) => `    * ${supplierDocumentEmailLabel(type)}`);
  const sampleInstruction = templateAttached
    ? "1. 本邮件已附上预填好的 Excel 合同样本，请打印合同并加盖公司公章，扫描后回传。"
    : "1. 请登录平台下载预填好的合同样本，打印合同并加盖公司公章，扫描后回传。";
  return {
    supplierName,
    orderNo,
    requiredDocumentLines: documentLines.join("\n"),
    dueDate: dueDate ? dateToInput(dueDate) : "-",
    sampleInstruction,
    paymentVoucherInstruction: paymentVoucherAttached
      ? "5. 已付款的汇款水单已随邮件附件发送，请核对后回传对应资料。"
      : "",
    messageBlock: message ? ["", "补充说明", "", message].join("\n") : "",
    companyName,
  };
}

export async function readValidatedExcelTemplate(file: unknown): Promise<ExcelUploadFile | null> {
  if (!file || !(file instanceof File) || !file.size) return null;
  const originalFileName = safeFileName(file.name || "factory-document-template.xlsx");
  const lowerName = originalFileName.toLowerCase();
  const isXlsx = lowerName.endsWith(".xlsx");
  const isXls = lowerName.endsWith(".xls");
  if (!isXlsx && !isXls) {
    throw codedError(
      "合同样本仅支持 .xls 或 .xlsx Excel 文件，不能上传其它格式。",
      400,
      "INVALID_TEMPLATE_TYPE",
    );
  }
  if (Number(file.size || 0) > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 4MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const body = Buffer.from(await file.arrayBuffer());
  if (body.byteLength > MAX_EXCEL_TEMPLATE_BYTES) {
    throw codedError("合同样本文件大小不能超过 4MB", 413, "TEMPLATE_FILE_TOO_LARGE");
  }
  const signature = body.subarray(0, 4).toString("hex");
  if ((isXlsx && signature !== "504b0304") || (isXls && signature !== "d0cf11e0")) {
    throw codedError(
      "合同样本格式错误，只能上传有效 .xls 或 .xlsx 文件。",
      400,
      "INVALID_TEMPLATE_SIGNATURE",
    );
  }
  return {
    originalFileName,
    mimeType: file.type || (isXls ? LEGACY_EXCEL_TEMPLATE_MIME : EXCEL_TEMPLATE_MIME),
    body,
    fileSize: Number(file.size || body.byteLength),
  };
}
