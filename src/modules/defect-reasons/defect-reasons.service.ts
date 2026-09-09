import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DefectReason } from '../../generated/prisma/client';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { paginate } from '../../common/utils/paginate.util';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';
import { CreateDefectReasonDto } from './dto/create-defect-reason.dto';
import { DefectReasonResponseDto } from './dto/defect-reason-response.dto';
import { UpdateDefectReasonDto } from './dto/update-defect-reason.dto';

/**
 * No isActive/deletedAt in docs/dna-erp-db-schema.html "defect_reasons" - remove() is a
 * real DELETE, same as material-groups.
 *
 * ĐÍNH CHÍNH (audit toàn diện 09/09/2026, mục Trung bình): comment gốc "nothing references this
 * table yet" đã LỖI THỜI - QcReview.defectReasonId (từ P9, migration 20260811063513) tham chiếu
 * bảng này với FK `ON DELETE SET NULL` (đối chiếu migration.sql thật, không phải chỉ đọc
 * schema.prisma). Xoá 1 lý do lỗi đang được dùng trong lịch sử KCS trước đây thành công lặng lẽ và
 * NULL hoá defectReasonId của MỌI lần duyệt KCS từng dùng lý do đó - mất khả năng tra cứu "lỗi nào
 * xảy ra bao nhiêu lần" trong quá khứ mà không có cảnh báo gì. remove() giờ chặn (409) nếu còn
 * QcReview nào tham chiếu, thay vì để FK âm thầm SET NULL.
 */
@Injectable()
export class DefectReasonsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async create(dto: CreateDefectReasonDto): Promise<DefectReasonResponseDto> {
    const reason = await this.prisma.defectReason.create({
      data: { label: dto.label, stageType: dto.stageType },
    });
    return this.toResponseDto(reason);
  }

  async findAll(query: PaginationQueryDto): Promise<Paginated<DefectReasonResponseDto>> {
    const where = query.search
      ? { label: { contains: query.search, mode: 'insensitive' as const } }
      : undefined;

    const result = await paginate(
      {
        findMany: (args) => this.prisma.defectReason.findMany(args),
        count: (args) => this.prisma.defectReason.count(args),
      },
      query,
      where,
      query.sortBy ? { [query.sortBy]: query.sortOrder } : { id: query.sortOrder },
    );

    return { data: result.data.map((r) => this.toResponseDto(r)), meta: result.meta };
  }

  async findOne(id: string): Promise<DefectReasonResponseDto> {
    return this.toResponseDto(await this.findOneOrThrow(id));
  }

  async update(id: string, dto: UpdateDefectReasonDto): Promise<DefectReasonResponseDto> {
    const bigId = parseBigIntId(id);
    await this.findOneOrThrow(id);

    const reason = await this.prisma.defectReason.update({
      where: { id: bigId },
      data: { label: dto.label, stageType: dto.stageType },
    });
    return this.toResponseDto(reason);
  }

  async remove(id: string): Promise<void> {
    const bigId = parseBigIntId(id);
    const reason = await this.findOneOrThrow(id);

    const usageCount = await this.prisma.qcReview.count({ where: { defectReasonId: bigId } });
    if (usageCount > 0) {
      throw new ConflictException(
        `Lý do lỗi "${reason.label}" đang được dùng trong ${usageCount} lượt duyệt KCS - ` +
          `xoá sẽ làm mất dấu vết lịch sử. Đổi tên thay vì xoá-tạo-lại nếu chỉ cần sửa chính tả/trùng lặp.`,
      );
    }

    await this.prisma.defectReason.delete({ where: { id: bigId } });
  }

  private async findOneOrThrow(id: string): Promise<DefectReason> {
    const bigId = parseBigIntId(id);
    const reason = await this.prisma.defectReason.findUnique({ where: { id: bigId } });
    if (!reason) {
      throw new NotFoundException(`Defect reason ${id} not found`);
    }
    return reason;
  }

  private toResponseDto(reason: DefectReason): DefectReasonResponseDto {
    return new DefectReasonResponseDto({
      id: reason.id.toString(),
      label: reason.label,
      stageType: reason.stageType,
    });
  }
}
