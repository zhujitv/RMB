function asciiDigits(value: string) {
  return value.replace(/[０-９]/g, (character) => String(character.charCodeAt(0) - 0xff10));
}

export function normalizeChinaMobilePhone(value: unknown): string | null {
  let phone = asciiDigits(String(value ?? "").trim());
  if (!phone) return null;
  phone = phone.replace(/[\s().（）\-]/g, "");
  if (phone.startsWith("0086")) phone = phone.slice(4);
  else if (phone.startsWith("+86")) phone = phone.slice(3);
  else if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  if (!/^1[3-9]\d{9}$/.test(phone)) return null;
  return `+86${phone}`;
}

export function maskPhone(value: unknown) {
  const normalized = normalizeChinaMobilePhone(value);
  if (!normalized) return "未配置";
  const local = normalized.slice(3);
  return `+86 ${local.slice(0, 3)}****${local.slice(-4)}`;
}
