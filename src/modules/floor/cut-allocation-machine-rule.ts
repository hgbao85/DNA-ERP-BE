import { BadRequestException } from '@nestjs/common';
import { CutMachineClass, SolverMachine, WorkstationKind } from '../../generated/prisma/client';
import { PrismaTx } from '../../prisma/prisma.service';
import { parseMachineByWorkshop } from '../cutting-proposals/steel-spec-key.util';

export const LASER_ON_AUTO_MESSAGE = 'Cây có đoạn dập (lỗ ô van) không cắt máy tự động';

/**
 * Luật duy nhất cho "dòng này có vào máy này được không" (đổi máy, tách, thêm dòng). Dùng chung cho
 * validate ở BE và cho `allowedMachineIds` gửi FE để hai bên không thể lệch nhau.
 * Dòng có đoạn dập (LASER) không vào máy tự động khi xưởng cho phép laze và có ít nhất 1 máy laze.
 */
export function isMachineAllowedForClass(input: {
  machineClass: CutMachineClass;
  targetType: SolverMachine | null;
  laserAllowed: boolean;
  laserMachineCount: number;
}): boolean {
  if (input.machineClass !== CutMachineClass.LASER) return true;
  if (input.targetType !== SolverMachine.tu_dong) return true;
  return !(input.laserAllowed && input.laserMachineCount >= 1);
}

/** Id các máy (đã là máy cắt đang dùng của xưởng) mà dòng thuộc `machineClass` được vào. */
export function allowedMachineIdsFor(
  machineClass: CutMachineClass,
  machines: Array<{ id: bigint; cutMachineType: SolverMachine | null }>,
  laserAllowed: boolean,
): string[] {
  const laserMachineCount = machines.filter((m) => m.cutMachineType === SolverMachine.laser).length;
  return machines
    .filter((m) =>
      isMachineAllowedForClass({
        machineClass,
        targetType: m.cutMachineType,
        laserAllowed,
        laserMachineCount,
      }),
    )
    .map((m) => m.id.toString());
}

/**
 * Máy đích: máy CUT đang dùng của đúng xưởng và hợp luật lớp máy (xem isMachineAllowedForClass).
 */
export async function assertTargetMachine(
  tx: PrismaTx,
  workshop: { id: bigint; code: string },
  machineClass: CutMachineClass,
  workstationId: bigint,
): Promise<void> {
  const target = await tx.workstation.findUnique({
    where: { id: workstationId },
    select: { workshopId: true, kind: true, isActive: true, cutMachineType: true },
  });
  if (
    !target ||
    target.kind !== WorkstationKind.CUT ||
    !target.isActive ||
    target.workshopId !== workshop.id
  ) {
    throw new BadRequestException('Máy đích phải là máy cắt đang dùng của đúng xưởng này');
  }
  // Chỉ dòng LASER sang máy tự động mới cần tra cấu hình xưởng và đếm máy laze.
  if (machineClass !== CutMachineClass.LASER || target.cutMachineType !== SolverMachine.tu_dong) {
    return;
  }
  const config = await tx.systemConfig.findUnique({
    where: { id: 1 },
    select: { solverMachineByWorkshop: true },
  });
  const laserAllowed =
    (parseMachineByWorkshop(config?.solverMachineByWorkshop)[workshop.code] ?? null) !== 'tu_dong';
  const laserMachineCount = laserAllowed
    ? await tx.workstation.count({
        where: {
          workshopId: workshop.id,
          kind: WorkstationKind.CUT,
          isActive: true,
          cutMachineType: SolverMachine.laser,
        },
      })
    : 0;
  const allowed = isMachineAllowedForClass({
    machineClass,
    targetType: target.cutMachineType,
    laserAllowed,
    laserMachineCount,
  });
  if (!allowed) throw new BadRequestException(LASER_ON_AUTO_MESSAGE);
}
