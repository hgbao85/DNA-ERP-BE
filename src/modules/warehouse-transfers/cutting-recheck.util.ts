import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';

/**
 * Lệnh có đang chờ KHSX kiểm lại phương án cắt sau khi đổi xưởng không (anh Nhân 10/11/2026: chưa bấm "Đã kiểm" thì thủ kho chưa
 * lập phiếu chuyển sắt và chưa xuất sắt cho lệnh).
 *
 * Cờ `ProductionInvoice.cuttingRecheckRequired` do người A bật trong changeWorkshop() (lệnh đã có phương án cắt APPROVED) và tắt khi
 * KHSX bấm "Đã kiểm". Đây là chỗ DUY NHẤT người B đọc cờ.
 */
export async function isCuttingRecheckPending(
  db: PrismaServiceType | PrismaTx,
  productionInvoiceId: bigint,
): Promise<boolean> {
  const pi = await db.productionInvoice.findUnique({
    where: { id: productionInvoiceId },
    select: { cuttingRecheckRequired: true },
  });
  return pi?.cuttingRecheckRequired === true;
}

export const CUTTING_RECHECK_MESSAGE =
  'Lệnh vừa đổi xưởng, KHSX chưa kiểm lại phương án cắt (chưa bấm "Đã kiểm") - chưa lập phiếu chuyển sắt / chưa xuất sắt được';
