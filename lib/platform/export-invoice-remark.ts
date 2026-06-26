import { dateToInput } from "./shared-base-utils";

export type ExportInvoiceRemarkContainer = {
  containerNo: string;
  type: string;
  truckNo: string;
  trailerNo: string;
  shipDate: string;
  origin: string;
  destination: string;
  goods: string;
};

export type ExportInvoiceRemark = {
  containers: ExportInvoiceRemarkContainer[];
};

type ExportInvoiceRemarkTransportItem = {
  containerNo?: unknown;
  containerType?: unknown;
  truckPlateNo?: unknown;
  trailerPlateNo?: unknown;
  departureDate?: unknown;
  departurePlace?: unknown;
  arrivalPlace?: unknown;
  cargoName?: unknown;
};

function text(value: unknown) {
  return String(value || "").trim();
}

function dateText(value: unknown) {
  if (!value) return "";
  return dateToInput(value as Date | string) || text(value);
}

function normalizeContainer(value: unknown): ExportInvoiceRemarkContainer {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    containerNo: text(input.containerNo),
    type: text(input.type),
    truckNo: text(input.truckNo),
    trailerNo: text(input.trailerNo),
    shipDate: text(input.shipDate),
    origin: text(input.origin),
    destination: text(input.destination),
    goods: text(input.goods),
  };
}

function hasContainerContent(container: ExportInvoiceRemarkContainer) {
  return Object.values(container).some(Boolean);
}

export function normalizeExportInvoiceRemark(value: unknown): ExportInvoiceRemark {
  const input = typeof value === "string"
    ? (() => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return {};
      }
    })()
    : value;
  const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const containers = Array.isArray(record.containers)
    ? record.containers.map(normalizeContainer).filter(hasContainerContent)
    : [];
  return { containers };
}

export function buildExportInvoiceRemarkFromTransportItems(items: ExportInvoiceRemarkTransportItem[] = []): ExportInvoiceRemark {
  return {
    containers: items.map((item) => ({
      containerNo: text(item.containerNo),
      type: text(item.containerType).toUpperCase(),
      truckNo: text(item.truckPlateNo),
      trailerNo: text(item.trailerPlateNo),
      shipDate: dateText(item.departureDate),
      origin: text(item.departurePlace),
      destination: text(item.arrivalPlace),
      goods: text(item.cargoName),
    })).filter(hasContainerContent),
  };
}

export function formatExportInvoiceRemark(value: unknown) {
  const remark = normalizeExportInvoiceRemark(value);
  return remark.containers.map((item) => [
    `Container: ${item.containerNo || "-"}`,
    `柜型：${item.type || "-"}`,
    `车牌：${item.truckNo || "-"}`,
    `挂车：${item.trailerNo || "-"}`,
    `起运：${item.shipDate || "-"}`,
    `路线：${item.origin || "-"} → ${item.destination || "-"}`,
    `货物：${item.goods || "-"}`,
  ].join("\n")).join("\n\n");
}
