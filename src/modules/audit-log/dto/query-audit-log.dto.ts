import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { AuditAction } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAuditLogDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tableName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  // 16/11/2026 - trang Admin "Nhật ký hoạt động" đọc thẳng bảng này (trước là mock localStorage). Bảng
  // tăng mãi nên lọc theo hành động + khoảng thời gian phải làm ở BE, không tải hết về FE để lọc.
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ description: 'createdAt >= from (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'createdAt <= to (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
