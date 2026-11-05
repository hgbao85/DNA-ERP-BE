import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { loadLenhDisplayCodes } from '../../common/utils/lenh-code.util';

/** Tối đa mã trong 1 lần tra - FE gom mã của cả màn hình vào 1 request. */
export const LENH_CODES_MAX = 500;

/**
 * Tra MÃ LỆNH HIỂN THỊ (số LSX nhà máy, lệnh gộp nối " + ") theo mã PI (2026-11-05, ẩn mã PI khỏi
 * giao diện - mã PI chỉ còn là khoá nội bộ). FE dùng cho mọi màn đang có sẵn mã PI trong dữ liệu
 * (kho, Phôi, KCS...) thay vì sửa từng API trả thêm trường. Cùng luật với
 * common/utils/lenh-code.util.ts (người A).
 */
@Injectable()
export class LenhCodesService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /** { "PI-2026-031": "MY-313", ... } - mã PI không tồn tại thì không có khoá. */
  async displayCodesByPiCode(piCodes: string[]): Promise<Record<string, string>> {
    const codes = [...new Set(piCodes.map((c) => c.trim()).filter(Boolean))].slice(
      0,
      LENH_CODES_MAX,
    );
    if (codes.length === 0) return {};
    const pis = await this.prisma.productionInvoice.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    const byId = await loadLenhDisplayCodes(
      this.prisma,
      pis.map((p) => p.id),
    );
    const out: Record<string, string> = {};
    for (const pi of pis) out[pi.code] = byId.get(pi.id.toString()) ?? pi.code;
    return out;
  }
}
