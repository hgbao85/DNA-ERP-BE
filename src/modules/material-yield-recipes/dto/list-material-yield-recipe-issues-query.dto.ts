import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MaterialYieldIssueStatus } from '../../../generated/prisma/client';

/** Query cho GET /material-yield-recipe-issues (flat, không cần productionInvoiceId) - cùng idiom
 *  ListMaterialYieldIssuesQueryDto: Phôi xem "đợt chờ/đã nhận của mình" mà không cần biết trước PI
 *  nào. */
export class ListMaterialYieldRecipeIssuesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MaterialYieldIssueStatus, enumName: 'MaterialYieldIssueStatus' })
  @IsOptional()
  @IsEnum(MaterialYieldIssueStatus)
  status?: MaterialYieldIssueStatus;
}
