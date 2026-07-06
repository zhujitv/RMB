type BusinessEntityRowStyles = {
  businessEntityOtherRow?: string;
};

function recordFrom(row: unknown) {
  return row && typeof row === "object" ? row as Record<string, unknown> : {};
}

function explicitBusinessEntityDefault(row: unknown) {
  const record = recordFrom(row);
  const nested = recordFrom(record.businessEntity);
  if (typeof record.businessEntityIsDefault === "boolean") return record.businessEntityIsDefault;
  if (typeof nested.isDefault === "boolean") return nested.isDefault;
  return true;
}

export function isDefaultBusinessEntityRow(row: unknown) {
  return explicitBusinessEntityDefault(row);
}

export function getBusinessEntityRowClass(
  row: unknown,
  styles: BusinessEntityRowStyles,
  ...baseClasses: Array<string | false | null | undefined>
) {
  const classNames = baseClasses.filter((className): className is string => Boolean(className));
  if (!isDefaultBusinessEntityRow(row) && styles.businessEntityOtherRow) {
    classNames.push(styles.businessEntityOtherRow);
  }
  return classNames.join(" ");
}
