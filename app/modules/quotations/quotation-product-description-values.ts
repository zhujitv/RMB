function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unwrappedSpecification(value: string) {
  return value.trim()
    .replace(/^[【[(（]\s*/u, "")
    .replace(/\s*[】\])）]$/u, "")
    .trim();
}

export function visibleProductDescriptionParts(value: string, existingSpecification = "") {
  const raw = value;
  const specification = existingSpecification.trim();
  if (specification) {
    const comparableSpecification = unwrappedSpecification(specification);
    if (comparableSpecification) {
      const suffix = new RegExp(
        `\\s*[（(]?\\s*${escapedRegExp(comparableSpecification)}\\s*[)）]?\\s*$`,
        "iu",
      );
      const match = suffix.exec(raw);
      const description = match ? raw.slice(0, match.index).trim() : "";
      if (description) return { description, specification };
    }
  }

  const combined = /^(.*?)\s*[（(]([^()（）]{1,500})[)）]\s*$/u.exec(raw);
  const description = combined?.[1]?.trim() || "";
  const parsedSpecification = combined?.[2]?.trim() || "";
  if (description && parsedSpecification) {
    return { description, specification: parsedSpecification };
  }
  return { description: raw, specification: "" };
}
