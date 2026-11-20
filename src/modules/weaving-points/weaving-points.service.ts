import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { isFamilyScope } from '../../common/utils/warehouse-family.util';
import { WeavingPoint } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { sortOrderBy } from '../../common/utils/sort-order-by.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateWeavingPointDto } from './dto/create-weaving-point.dto';
import { UpdateWeavingPointDto } from './dto/update-weaving-point.dto';
import { WeavingPointResponseDto } from './dto/weaving-point-response.dto';

/** `remove()` is a real hard delete (as originally built) - soft-delete for this model is
 * pending, see CONTRIBUTING.md "0. Ưu tiên". `isActive` is a separate, independent flag. */
/** Người gọi route ghi điểm đan (controller truyền xuống). Gọi nội bộ không truyền = không kiểm. */
type WeavingPointActor = { roles: string[]; warehouseScope: string | null };

@Injectable()
export class WeavingPointsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  /**
   * Test toàn hệ thống 19/11 (việc Bảo nhận từ Sang): chỉ Admin và thủ kho Phụ kiện (kho giao vật tư đan - màn "Quản lý điểm
   * đan" chỉ mở cho kho này) được thêm / sửa / xoá điểm đan. Trước đây quyền WEAVING_POINT:ALL đi theo vai nền "Nhân viên" của
   * mọi tài khoản văn phòng nên thủ kho nào / người mua nào cũng sửa xoá được qua API. Xem vẫn như cũ.
   */
  private assertCanManage(actor: WeavingPointActor | undefined): void {
    if (!actor) return;
    if (actor.roles.includes(DEFAULT_ROLES.ADMIN)) return;
    if (isFamilyScope(actor.warehouseScope, 'vat-tu-tp')) return;
    throw new ForbiddenException('Chỉ Admin hoặc thủ kho Phụ kiện được thêm / sửa / xoá điểm đan');
  }

  async create(
    dto: CreateWeavingPointDto,
    actor?: WeavingPointActor,
  ): Promise<WeavingPointResponseDto> {
    this.assertCanManage(actor);
    const existing = await this.prisma.weavingPoint.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Điểm đan "${dto.code}" đã tồn tại`);
    }

    const point = await this.prisma.weavingPoint.create({
      data: {
        code: dto.code,
        fullName: dto.fullName,
        aliasNote: dto.aliasNote,
        phone: dto.phone,
        address: dto.address,
        dayDaiPercent: dto.dayDaiPercent,
        ketThucPercent: dto.ketThucPercent,
        hangQuanPercent: dto.hangQuanPercent,
        note: dto.note,
      },
    });
    return this.toResponseDto(point);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<WeavingPointResponseDto>> {
    const where = query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { fullName: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.weavingPoint.findMany(args),
        count: (args) => this.prisma.weavingPoint.count(args),
      },
      query,
      where,
      sortOrderBy(query, ['id', 'code'], { id: query.sortOrder }),
    );

    return { data: result.data.map((p) => this.toResponseDto(p)), meta: result.meta };
  }

  async findOne(id: string): Promise<WeavingPointResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateWeavingPointDto,
    actor?: WeavingPointActor,
  ): Promise<WeavingPointResponseDto> {
    this.assertCanManage(actor);
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    if (dto.code) {
      const existing = await this.prisma.weavingPoint.findUnique({ where: { code: dto.code } });
      if (existing && existing.id !== bigId) {
        throw new ConflictException(`Điểm đan "${dto.code}" đã tồn tại`);
      }
    }

    const point = await this.prisma.weavingPoint.update({
      where: { id: bigId },
      data: {
        code: dto.code,
        fullName: dto.fullName,
        aliasNote: dto.aliasNote,
        phone: dto.phone,
        address: dto.address,
        dayDaiPercent: dto.dayDaiPercent,
        ketThucPercent: dto.ketThucPercent,
        hangQuanPercent: dto.hangQuanPercent,
        note: dto.note,
        isActive: dto.isActive,
      },
    });
    return this.toResponseDto(point);
  }

  async remove(id: string, actor?: WeavingPointActor): Promise<void> {
    this.assertCanManage(actor);
    const bigId = parseBigIntId(id);
    const point = await this.findOneOrThrow(id);
    // Test toàn hệ thống 19/11: điểm đan đã có phiếu (xuất đan, nhận đan, vật tư đan, phiếu XK - kể cả phiếu nháp) thì KHÔNG xoá.
    // Trước đây phiếu XK (khoá ngoại tuỳ chọn) âm thầm mất điểm đan khi xoá, còn bảng khác ra lỗi khoá ngoại thô. Khoá dòng điểm
    // đan trước khi đếm: phiếu mới tạo cùng lúc phải chờ (kiểm khoá ngoại xin khoá chia sẻ trên đúng dòng này).
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "weaving_points" WHERE id = ${bigId} FOR UPDATE`;
      const [issues, receipts, materials, slips] = await Promise.all([
        tx.weavingIssue.count({ where: { weavingPointId: bigId } }),
        tx.weavingReceipt.count({ where: { weavingPointId: bigId } }),
        tx.weavingIssueMaterial.count({ where: { weavingPointId: bigId } }),
        tx.issueSlip.count({ where: { weavingPointId: bigId } }),
      ]);
      const used = issues + receipts + materials + slips;
      if (used > 0) {
        throw new ConflictException(
          `Điểm đan "${point.fullName ?? point.code}" đã có ${used} phiếu / dòng xuất nhận đan gắn vào - không xoá được. Muốn thôi dùng thì sửa sang "Ngừng hoạt động"`,
        );
      }
      await tx.weavingPoint.delete({ where: { id: bigId } });
    });
  }

  private async findOneOrThrow(id: string): Promise<WeavingPoint> {
    const bigId = parseBigIntId(id);
    const point = await this.prisma.weavingPoint.findUnique({ where: { id: bigId } });
    if (!point) {
      throw new NotFoundException(`Không tìm thấy điểm đan ${id}`);
    }
    return point;
  }

  private toResponseDto(point: WeavingPoint): WeavingPointResponseDto {
    return new WeavingPointResponseDto({
      id: point.id.toString(),
      code: point.code,
      fullName: point.fullName,
      aliasNote: point.aliasNote,
      phone: point.phone,
      address: point.address,
      dayDaiPercent: point.dayDaiPercent?.toNumber() ?? null,
      ketThucPercent: point.ketThucPercent?.toNumber() ?? null,
      hangQuanPercent: point.hangQuanPercent?.toNumber() ?? null,
      note: point.note,
      isActive: point.isActive,
    });
  }
}
