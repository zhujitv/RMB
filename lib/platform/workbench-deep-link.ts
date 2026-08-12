const WORKBENCH_INTERNAL_ORIGIN = "https://workspace.internal";
const MAX_INTERNAL_HREF_LENGTH = 2_048;
const MAX_QUERY_VALUE_LENGTH = 512;

export const WORKBENCH_DEEP_LINK_PARAM = "workbenchTarget";

const WORKBENCH_ROUTE_QUERY_KEYS = new Map<string, ReadonlySet<string>>([
  ["/account", new Set()],
  ["/orders", new Set(["orderId", "keyword"])],
  ["/payments", new Set(["orderId", "keyword", "paymentId"])],
  ["/costs", new Set(["orderId", "keyword", "costId"])],
  ["/profit", new Set(["orderId", "keyword"])],
  ["/domestic-logistics", new Set(["orderId", "keyword"])],
  ["/customer-communication", new Set(["orderId", "keyword"])],
  ["/ocean-control-tower", new Set(["orderId", "keyword", "trackingId"])],
  ["/logistics-fees", new Set(["orderId", "keyword", "billId"])],
  ["/supplier-purchase-orders", new Set(["keyword", "purchaseOrderId"])],
  ["/supplier-documents", new Set(["orderId", "keyword", "requestId"])],
  ["/tax-refund", new Set(["orderId", "keyword", "status", "action"])],
]);

function containsUnsafeCharacters(value: string) {
  return /[\\\u0000-\u001f\u007f]/.test(value);
}

function internalHref(url: URL) {
  return `${url.pathname}${url.search}`;
}

/**
 * Parses only the internal module destinations understood by WorkspaceShell.
 * The returned URL uses a fixed fake origin so callers never need to resolve
 * untrusted destinations against the public application origin.
 */
export function parseWorkbenchInternalHref(input: unknown): URL | null {
  if (typeof input !== "string") return null;
  const rawHref = input.trim();
  if (
    !rawHref
    || rawHref !== input
    || rawHref.length > MAX_INTERNAL_HREF_LENGTH
    || !rawHref.startsWith("/")
    || rawHref.startsWith("//")
    || containsUnsafeCharacters(rawHref)
  ) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawHref, WORKBENCH_INTERNAL_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.origin !== WORKBENCH_INTERNAL_ORIGIN || parsed.hash) return null;
  const allowedQueryKeys = WORKBENCH_ROUTE_QUERY_KEYS.get(parsed.pathname);
  if (!allowedQueryKeys) return null;

  const normalized = new URL(parsed.pathname, WORKBENCH_INTERNAL_ORIGIN);
  const seenKeys = new Set<string>();
  for (const [key, value] of parsed.searchParams) {
    if (
      !allowedQueryKeys.has(key)
      || seenKeys.has(key)
      || value.length > MAX_QUERY_VALUE_LENGTH
      || containsUnsafeCharacters(value)
    ) return null;
    seenKeys.add(key);
    normalized.searchParams.set(key, value);
  }
  return normalized;
}

export function buildWorkbenchDeepLink(appUrl: string, targetHref: unknown): string | null {
  const target = parseWorkbenchInternalHref(targetHref);
  if (!target) return null;

  let destination: URL;
  try {
    destination = new URL("/", appUrl);
  } catch {
    return null;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") return null;
  destination.username = "";
  destination.password = "";
  destination.hash = "";
  destination.search = "";
  destination.searchParams.set(WORKBENCH_DEEP_LINK_PARAM, internalHref(target));
  return destination.toString();
}

export type WorkbenchDeepLinkTarget = {
  present: boolean;
  target: URL | null;
};

export function readWorkbenchDeepLink(currentUrl: string): WorkbenchDeepLinkTarget {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl, WORKBENCH_INTERNAL_ORIGIN);
  } catch {
    return { present: false, target: null };
  }
  const values = parsed.searchParams.getAll(WORKBENCH_DEEP_LINK_PARAM);
  if (!values.length) return { present: false, target: null };
  return {
    present: true,
    target: values.length === 1 ? parseWorkbenchInternalHref(values[0]) : null,
  };
}

export function removeWorkbenchDeepLink(currentUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(currentUrl, WORKBENCH_INTERNAL_ORIGIN);
  } catch {
    return "/";
  }
  parsed.searchParams.delete(WORKBENCH_DEEP_LINK_PARAM);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
