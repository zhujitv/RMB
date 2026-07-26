import { NextResponse } from "next/server";
import { apiError, type AppError } from "./shared-base-errors";

export async function apiErrorSafe500(
  error: unknown,
  fallback: string,
  fallbackCode = "INTERNAL_ERROR",
) {
  const typedError = (error || {}) as AppError;
  const response = apiError(error, fallback);
  if (response.status < 500 || typedError.expose) return response;
  return NextResponse.json({ error: fallback, code: fallbackCode }, { status: response.status });
}

export async function apiErrorWithLegacyShape(
  error: unknown,
  fallback: string,
  fallbackCode: string,
) {
  const response = await apiErrorSafe500(error, fallback, fallbackCode);
  const payload = await response.json() as { error?: string; code?: string };
  return NextResponse.json({
    success: false,
    errorCode: payload.code || fallbackCode,
    message: payload.error || fallback,
  }, { status: response.status });
}
