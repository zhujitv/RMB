import { nonEmpty } from "./shared-base-utils";

export function normalizeFreightowerPortCode(value: unknown) {
  const code = nonEmpty(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{2}[A-Z0-9]{3}$/.test(code) ? code : "";
}

export function normalizeFreightowerPortBusinessNumber(value: unknown) {
  return nonEmpty(value)
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, "")
    .slice(0, 80);
}

export function resolveFreightowerPortContext(input: {
  storedPort?: unknown;
  storedDirection?: unknown;
  origin?: unknown;
  destination?: unknown;
  defaultPort?: unknown;
  defaultDirection?: unknown;
}) {
  const origin = normalizeFreightowerPortCode(input.origin);
  const destination = normalizeFreightowerPortCode(input.destination);
  if (origin.startsWith("CN")) return { portCode: origin, direction: "E" };
  if (destination.startsWith("CN")) return { portCode: destination, direction: "I" };

  const storedPort = normalizeFreightowerPortCode(input.storedPort);
  const storedDirection = nonEmpty(input.storedDirection).toUpperCase();
  if (storedPort) {
    return { portCode: storedPort, direction: storedDirection === "I" ? "I" : "E" };
  }

  const defaultPort = normalizeFreightowerPortCode(input.defaultPort);
  const defaultDirection = nonEmpty(input.defaultDirection).toUpperCase();
  return {
    portCode: defaultPort,
    direction: defaultDirection === "I" ? "I" : "E",
  };
}
