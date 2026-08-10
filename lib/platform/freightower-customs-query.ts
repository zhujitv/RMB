import { nonEmpty } from "./shared-base-utils";

export function normalizeFreightowerCustomsBillNumber(value: unknown) {
  return nonEmpty(value)
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, "")
    .slice(0, 80);
}

export function resolveFreightowerCustomsContext(input: {
  storedDirection?: unknown;
  storedPort?: unknown;
  origin?: unknown;
  destination?: unknown;
  configuredDirection?: unknown;
}) {
  const storedDirection = nonEmpty(input.storedDirection).toUpperCase();
  const storedPort = nonEmpty(input.storedPort).toUpperCase();
  const origin = nonEmpty(input.origin).toUpperCase();
  const destination = nonEmpty(input.destination).toUpperCase();
  const configured = nonEmpty(input.configuredDirection).toUpperCase();
  if (origin.startsWith("CN")) return { direction: "E", hasChinaPort: true };
  if (destination.startsWith("CN")) return { direction: "I", hasChinaPort: true };
  if (storedDirection === "I" || storedDirection === "E") {
    return { direction: storedDirection, hasChinaPort: storedPort.startsWith("CN") };
  }
  if (storedPort.startsWith("CN")) {
    const direction = configured === "I" || configured === "E" ? configured : "";
    return { direction, hasChinaPort: true };
  }
  return {
    direction: configured === "I" || configured === "E" ? configured : "",
    hasChinaPort: false,
  };
}
