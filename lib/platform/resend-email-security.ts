import {
  codedError,
  isPlainRecord,
  redactSensitiveText,
} from "./shared-base-utils";
import {
  createOutboundTimeoutSignal,
  readResponseTextLimited,
} from "./outbound-request-security";

const DEFAULT_RESEND_TIMEOUT_MS = 10_000;
const RESEND_ERROR_RESPONSE_MAX_BYTES = 256 * 1024;

export function resendRequestSignal() {
  const configured = Number(process.env.RESEND_SEND_TIMEOUT_MS || DEFAULT_RESEND_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured)
    ? Math.min(30_000, Math.max(1_000, configured))
    : DEFAULT_RESEND_TIMEOUT_MS;
  return createOutboundTimeoutSignal(timeoutMs);
}

export async function assertResendResponseOk(response: Response) {
  if (response.ok) {
    await response.body?.cancel();
    return;
  }
  let data: Record<string, unknown> = {};
  try {
    const text = await readResponseTextLimited(response, RESEND_ERROR_RESPONSE_MAX_BYTES);
    const parsed = text ? JSON.parse(text) as unknown : {};
    data = isPlainRecord(parsed) ? parsed : {};
  } catch {
    data = {};
  }
  const nestedError = isPlainRecord(data.error) ? data.error : {};
  const rawReason = data.message || nestedError.message || data.error || `HTTP ${response.status}`;
  const reason = redactSensitiveText(rawReason, 300);
  throw codedError(`Resend 邮件发送失败：${reason}`, response.status, "RESEND_SEND_FAILED");
}
