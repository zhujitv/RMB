export function maskCustomsDeclarationNumbers(value: string) {
  return value.replace(/\b(\d{4})\d{10}(\d{4})\b/g, "$1******$2");
}
