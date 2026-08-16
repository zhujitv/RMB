export type TencentSmsFailureClassification = {
  retryable: boolean;
  outcomeUnknown: boolean;
};

function normalizedCode(value: unknown) {
  const code = String(value ?? "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/.test(code) ? code : "UNKNOWN";
}

function startsWithAny(value: string, prefixes: readonly string[]) {
  return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}.`));
}

export function classifyTencentSmsFailure(
  codeValue: unknown,
  options: { transportError?: boolean; requestId?: string } = {},
): TencentSmsFailureClassification {
  const code = normalizedCode(codeValue);
  const upper = code.toUpperCase();
  if (upper === "OK") return { retryable: false, outcomeUnknown: false };

  const transportWithoutConfirmedResponse = options.transportError === true && !options.requestId;
  const definitelyNotSubmittedTransportCodes = new Set([
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ]);
  if (transportWithoutConfirmedResponse) {
    return {
      retryable: true,
      outcomeUnknown: !definitelyNotSubmittedTransportCodes.has(upper),
    };
  }

  if (startsWithAny(code, [
    "InternalError",
    "RequestLimitExceeded",
    "ResourceUnavailable",
    "LimitExceeded",
    "FailedOperation.FrequencyLimit",
    "FailedOperation.SystemBusy",
    "FailedOperation.NetworkError",
  ])) {
    return {
      retryable: true,
      outcomeUnknown: startsWithAny(code, ["InternalError"]),
    };
  }

  return { retryable: false, outcomeUnknown: false };
}
