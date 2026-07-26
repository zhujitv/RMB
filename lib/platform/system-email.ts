import { codedError } from "./shared-base-utils";
import { assertResendResponseOk, resendRequestSignal } from "./resend-email-security";

type SendSystemEmailInput = {
  recipientEmails: string[];
  ccEmails?: string[];
  subject: string;
  body: string;
  idempotencyKey?: string;
};

function resendMailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || process.env.MAIL_FROM;
  const endpoint = process.env.RESEND_EMAIL_ENDPOINT || "https://api.resend.com/emails";
  if (!apiKey || !from) {
    throw codedError("Resend 邮件服务未配置，未发送。", 500, "MAIL_SERVICE_NOT_CONFIGURED");
  }
  return { apiKey, from, endpoint };
}

export async function sendSystemEmail({ recipientEmails, ccEmails = [], subject, body, idempotencyKey }: SendSystemEmailInput) {
  const { apiKey, from, endpoint } = resendMailConfig();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: recipientEmails,
      cc: ccEmails.length ? ccEmails : undefined,
      subject,
      text: body,
    }),
    signal: resendRequestSignal(),
  });
  await assertResendResponseOk(response);
}
