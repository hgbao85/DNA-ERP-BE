import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MinLength } from 'class-validator';

/**
 * Việc 3b (changelog-2026-09-11-bom-revision-ghim-cu-canh-bao.md mục 8.6): đường sửa CHÍNH THỐNG
 * để một ProductionOrder chuyển sang bám bản định mức ACTIVE mới nhất, thay cho việc sửa thẳng
 * DB - lý do bắt buộc để lại vết cho ai đọc lại sau (production-orders.service.ts sẽ tự ghi
 * AuditLog thủ công vì ProductionOrder không nằm trong AUDITED_MODELS tự động).
 */
export class ResyncBomDto {
  @ApiProperty({
    example: 'Định mức sắt tròn Ø4 vừa sửa lại đúng 60mm (trước đó khai nhầm 6mm)',
    description: 'Vì sao nạp lại định mức cho lệnh này - bắt buộc, Sếp/QLSX đọc lại được sau này.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  reason!: string;
}
