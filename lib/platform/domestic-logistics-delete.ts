import { prisma } from "../prisma";
import { assertBusinessNotArchived, lockBusinessOrderForUpdate } from "./business-archive";
import { domesticLogisticsSelectWithOrder } from "./domestic-logistics-ops";
import { codedError } from "./shared-base-errors";
import { writeAudit } from "./shared-audit";
import type { AuditRequestLike, DomesticLogisticsActor } from "./domestic-logistics-context";

export async function deleteDomesticLogisticsInfoInTransaction(
  request: AuditRequestLike,
  actor: DomesticLogisticsActor,
  id: string,
) {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.domesticLogisticsInfo.findFirst({
      where: { id, deletedAt: null },
      select: { orderId: true },
    });
    if (!candidate) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
    await lockBusinessOrderForUpdate(tx, candidate.orderId);
    const before = await tx.domesticLogisticsInfo.findFirst({
      where: { id, orderId: candidate.orderId, deletedAt: null },
      select: domesticLogisticsSelectWithOrder(),
    });
    if (!before) throw codedError("物流信息不存在", 404, "DOMESTIC_LOGISTICS_NOT_FOUND");
    assertBusinessNotArchived(before.order,
      "该订单已提交退税并归档，不能删除物流信息；如需更正，请先取消退税归档。");
    const row = await tx.domesticLogisticsInfo.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: domesticLogisticsSelectWithOrder(),
    });
    await writeAudit(request, actor, "删除物流信息", "domestic_logistics_infos", row.id, before, row, tx);
    return row;
  });
}
