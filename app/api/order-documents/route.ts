import { NextResponse, type NextRequest } from "next/server";
import {
  apiError,
  assertPdfUploadFileCandidate,
  codedError,
  listOrderDocuments,
  logServerError,
  ok,
  uploadOrderDocument,
} from "../../../lib/platform-db";

import { requireApiActor } from "../../../lib/api-route-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type ErrorLike = {
  status?: number;
  code?: string;
  message?: string;
  stack?: string;
  expose?: boolean;
};

type UploadActor = {
  id?: string;
} | null;

type UploadFailureContext = {
  actor: UploadActor;
  orderId: string;
  documentType: string;
  file: File | null;
  error: ErrorLike;
};

export async function GET(request: NextRequest) {
  try {
    const actor = await requireApiActor(request);
    const query = new URL(request.url).searchParams;
    return ok({ documents: await listOrderDocuments(query, actor) });
  } catch (error: unknown) {
    return apiError(error, "读取订单单证失败");
  }
}

export async function POST(request: NextRequest) {
  let actor: UploadActor = null;
  let orderId = "";
  let documentType = "";
  let file: File | null = null;
  try {
    actor = await requireApiActor(request);
    const formData = await request.formData();
    const candidate = formData.get("file");
    orderId = String(formData.get("orderId") || "").trim();
    documentType = String(formData.get("documentType") || "").trim();
    if (!orderId || !documentType) {
      throw codedError("缺少订单信息，不能上传文件，请刷新后重试。", 400, "UPLOAD_CONTEXT_MISSING");
    }
    file = assertPdfUploadFileCandidate(candidate).file;
    const document = await uploadOrderDocument(request, actor, {
      orderId,
      documentType,
      costId: String(formData.get("costId") || ""),
      supplierId: String(formData.get("supplierId") || ""),
      customsDeclarationId: String(formData.get("customsDeclarationId") || ""),
      uploadSource: String(formData.get("uploadSource") || ""),
      file,
    });
    return NextResponse.json({
      success: true,
      data: document,
      document,
      message: "上传成功",
    });
  } catch (error: unknown) {
    const typedError = (error || {}) as ErrorLike;
    logUploadFailure({ actor, orderId, documentType, file, error: typedError });
    return uploadError(typedError, "上传订单单证失败");
  }
}

function logUploadFailure({ actor, orderId, documentType, file, error }: UploadFailureContext) {
  logServerError("订单单证上传失败", error, {
    orderId: orderId || "",
    documentType: documentType || "",
    fileSize: Number(file?.size || 0),
    mimeType: file?.type || "",
    userId: actor?.id || "",
  });
}

function uploadError(error: ErrorLike, fallback = "上传订单单证失败") {
  const isProduction = process.env.NODE_ENV === "production";
  const status = error?.status || 500;
  const message = isProduction && status >= 500 && !error?.expose ? fallback : (error?.message || fallback);
  return NextResponse.json({
    success: false,
    message,
    error: message,
    code: error?.code || undefined,
    errorCode: error?.code || undefined,
  }, { status });
}
