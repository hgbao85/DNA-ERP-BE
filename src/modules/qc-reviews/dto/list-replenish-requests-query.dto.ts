import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ReplenishRequestStatus } from '../../../generated/prisma/client';

export class ListReplenishRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReplenishRequestStatus })
  @IsOptional()
  @IsEnum(ReplenishRequestStatus)
  status?: ReplenishRequestStatus;
}
