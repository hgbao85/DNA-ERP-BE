import { PrismaServiceType } from '../../prisma/prisma.service';

/**
 * DB unique constraint trên `code` là lưới chặn thật cho race hiếm gặp (2 request đọc cùng 1 số
 * rồi cùng tạo) - cùng idiom "đọc rồi tạo, để DB bắt race" đã dùng cho WarehouseTransfer.code/
 * BomRevision.revNo. Scoped theo năm để PI-{id} cũ (không có năm) không còn lẫn giữa các năm khi
 * liệt kê/tìm theo mã.
 *
 * Lấy MAX số thứ tự hiện có + 1 - KHÔNG dùng COUNT(*): PI có thể bị xoá thật (Sếp từ chối một đợt
 * gộp xoá hẳn PI, xem ProductionInvoicesService.rejectBatch), để lại lỗ hổng trong dãy số. Dùng
 * COUNT sau khi có lỗ hổng sẽ tính ra đúng số của một mã CÒN TỒN TẠI, đụng unique constraint (bug
 * thật đã xảy ra: xoá PI-2026-003/007/013 để lại 10 dòng, COUNT=10 -> sinh lại "PI-2026-011" dù mã
 * đó vẫn còn dùng).
 */
export async function nextProductionInvoiceCode(prisma: PrismaServiceType): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PI-${year}-`;
  const rows = await prisma.productionInvoice.findMany({
    where: { code: { startsWith: prefix } },
    select: { code: true },
  });
  const maxSeq = rows.reduce((max, { code }) => {
    const seq = parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}
