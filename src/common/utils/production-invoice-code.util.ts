import { PrismaServiceType } from '../../prisma/prisma.service';

/**
 * DB unique constraint trên `code` là lưới chặn thật cho race hiếm gặp (2 request đếm cùng 1
 * số rồi cùng tạo) - cùng idiom "đếm rồi tạo, để DB bắt race" đã dùng cho
 * WarehouseTransfer.code/BomRevision.revNo. Scoped theo năm để PI-{id} cũ (không có năm) không
 * còn lẫn giữa các năm khi liệt kê/tìm theo mã.
 */
export async function nextProductionInvoiceCode(prisma: PrismaServiceType): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PI-${year}-`;
  const count = await prisma.productionInvoice.count({
    where: { code: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(3, '0')}`;
}
