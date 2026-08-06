import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TransferStatus } from '../../../generated/prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListWarehouseTransfersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TransferStatus })
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  /** Hộp thư chờ nhận của 1 kho đích cụ thể. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  toWarehouseId?: string;
}
