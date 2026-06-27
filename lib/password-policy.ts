export const PASSWORD_POLICY_MESSAGE = "密码至少 8 位，且需包含至少 2 个英文字母，并同时包含大小写字母。";

export function passwordPolicyChecks(password: unknown) {
  const text = String(password || "");
  const englishLetters = text.match(/[A-Za-z]/g) || [];
  return {
    minLength: text.length >= 8,
    atLeastTwoLetters: englishLetters.length >= 2,
    hasUppercase: /[A-Z]/.test(text),
    hasLowercase: /[a-z]/.test(text),
  };
}

export function passwordMeetsPolicy(password: unknown) {
  const checks = passwordPolicyChecks(password);
  return checks.minLength && checks.atLeastTwoLetters && checks.hasUppercase && checks.hasLowercase;
}

export function passwordPolicyError(password: unknown) {
  return passwordMeetsPolicy(password) ? "" : PASSWORD_POLICY_MESSAGE;
}
