import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { CutAllocationChangeReason } from '../../../generated/prisma/client';

/** Id dạng chuỗi số (BigInt) - DTO chỉ kiểm dạng, service kiểm tồn tại. */
const ID_PATTERN = /^\d+$/;
const ID_MESSAGE = 'Mã (id) không hợp lệ';

export const CUT_ALLOCATION_MODES = ['append', 'redo'] as const;
export type CutAllocationMode = (typeof CUT_ALLOCATION_MODES)[number];

/** Lý do điều chuyển: đổi máy dòng theo bó bắt buộc MACHINE_BROKEN, dòng thường tuỳ chọn. */
export const CUT_ALLOCATION_CHANGE_REASONS = ['MACHINE_BROKEN', 'OTHER'] as const;

/** Lý do + ghi chú kèm thao tác sửa tay (lưu vào nhật ký chia máy). */
export class CutAllocationChangeNoteDto {
  @ApiPropertyOptional({
    enum: CUT_ALLOCATION_CHANGE_REASONS,
    enumName: 'CutAllocationChangeReason',
  })
  @IsOptional()
  @IsEnum(CutAllocationChangeReason)
  reason?: 'MACHINE_BROKEN' | 'OTHER';

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300, { message: 'Ghi chú tối đa 300 ký tự' })
  note?: string;
}

/** GET /floor/cut-allocation?workshopId= */
export class CutAllocationQueryDto {
  @ApiPropertyOptional({ description: 'Bắt buộc với QLSX chung (không gắn xưởng)' })
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;
}

/** POST /floor/cut-allocation/auto */
export class AutoCutAllocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;

  @ApiProperty({
    enum: CUT_ALLOCATION_MODES,
    description: 'append = chia phần còn lại; redo = chia lại (giữ dòng sửa tay)',
  })
  @IsIn(CUT_ALLOCATION_MODES)
  mode!: CutAllocationMode;
}

/** POST /floor/cut-allocation/add */
export class AddCutAllocationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;

  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  productionInvoiceId!: string;

  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  materialId!: string;
}

/** PATCH /floor/cut-allocation/:id */
export class UpdateCutAllocationDto extends CutAllocationChangeNoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workstationId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt({ message: 'Số cây phải là số nguyên' })
  @Min(1, { message: 'Số cây phải >= 1' })
  barCount?: number;
}

/** POST /floor/cut-allocation/:id/split */
export class SplitCutAllocationDto extends CutAllocationChangeNoteDto {
  @ApiProperty({ minimum: 1, description: 'Số cây tách sang dòng mới (1..barCount−1)' })
  @IsInt({ message: 'Số cây phải là số nguyên' })
  @Min(1, { message: 'Số cây phải >= 1' })
  barCount!: number;

  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workstationId!: string;
}

/** POST /floor/cut-allocation/reorder - đúng tập dòng còn hiệu lực trên máy, theo thứ tự mới. */
export class ReorderCutAllocationDto {
  @ApiProperty()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workstationId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(ID_PATTERN, { each: true, message: ID_MESSAGE })
  rowIds!: string[];
}

/** GET /floor/cut-allocation/log - mặc định 30 ngày gần nhất (giờ VN), tối đa 500 dòng. */
export class CutAllocationLogQueryDto {
  @ApiPropertyOptional({ description: 'Bắt buộc với QLSX chung (không gắn xưởng)' })
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  workshopId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(ID_PATTERN, { message: ID_MESSAGE })
  productionInvoiceId?: string;

  @ApiPropertyOptional({
    description: 'Từ ngày YYYY-MM-DD (giờ VN). Mặc định: 30 ngày trước `to`.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from phải dạng YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Đến ngày YYYY-MM-DD (giờ VN, gồm cả ngày này). Mặc định: hôm nay.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to phải dạng YYYY-MM-DD' })
  to?: string;
}
