import { Prisma } from "../generated/prisma/client.js";
import {
  ACTIVE_TAX_REFUND_STATUSES,
  ARCHIVE_TAX_REFUND_STATUSES,
} from "./shared-constants";

const activeCustomsDeclarationWhere: Prisma.CustomsDeclarationWhereInput = {
  deletedAt: null,
  taxArchived: false,
  taxRefundArchivedAt: null,
  taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
};

const archivedCustomsDeclarationWhere: Prisma.CustomsDeclarationWhereInput = {
  deletedAt: null,
  OR: [
    { taxArchived: true },
    { taxRefundArchivedAt: { not: null } },
    { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } },
  ],
};

export function orderTaxArchiveWhereForScope(scope = "current"): Prisma.ReceivableOrderWhereInput {
  if (scope === "all") return {};
  if (scope === "archive") {
    return {
      OR: [
        {
          customsDeclarations: {
            some: archivedCustomsDeclarationWhere,
            none: activeCustomsDeclarationWhere,
          },
        },
        {
          customsDeclarations: { none: { deletedAt: null } },
          OR: [
            { taxArchived: true },
            { taxRefundArchivedAt: { not: null } },
            { taxRefundStatus: { in: ARCHIVE_TAX_REFUND_STATUSES } },
          ],
        },
      ],
    };
  }
  return {
    OR: [
      { customsDeclarations: { some: activeCustomsDeclarationWhere } },
      {
        customsDeclarations: { none: { deletedAt: null } },
        taxArchived: false,
        taxRefundArchivedAt: null,
        taxRefundStatus: { in: ACTIVE_TAX_REFUND_STATUSES },
      },
    ],
  };
}
