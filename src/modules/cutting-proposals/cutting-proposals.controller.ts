import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { PreviewCuttingBatchDto } from './dto/cutting-batch-candidate.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { CuttingProposalsService } from './cutting-proposals.service';

const VIEW = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.CREATE };
const APPROVE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.APPROVE };

@ApiTags('Cutting Proposals')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CuttingProposalsController {
  constructor(private readonly cuttingProposalsService: CuttingProposalsService) {}

  /** Nút "Tính lại" thủ công - lần tính đầu tiên tự động chạy ngầm khi Sếp duyệt PI item. */
  @Post('production-orders/:id/cutting-proposals')
  @RequirePermissions(CREATE)
  requestProposal(
    @Param('id') id: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.cuttingProposalsService.requestForOrder(parseBigIntId(id), {
      idempotencyKey,
      requestedById: userId,
    });
  }

  @Get('production-orders/:id/cutting-proposals')
  @RequirePermissions(VIEW)
  findAllForOrder(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.cuttingProposalsService.findAllForOrder(id, query);
  }

  /** List toàn hệ thống - màn Admin "Cắt sắt" (business-data). */
  @Get('cutting-proposals')
  @RequirePermissions(VIEW)
  findAll(@Query() query: PaginationQueryDto) {
    return this.cuttingProposalsService.findAll(query);
  }

  /**
   * Gợi ý gộp đợt cắt cho KHSX - chỉ đọc, không gọi solver, không ghi gì. Badge số trên menu KHSX
   * cũng đếm từ chính endpoint này (độ dài mảng), nên KHÔNG cache: tính lại mỗi lần gọi để luôn
   * phản ánh đúng các PO Sales vừa tạo.
   */
  @Get('cutting-batch-suggestions')
  @RequirePermissions(VIEW)
  getBatchSuggestions() {
    return this.cuttingProposalsService.getBatchSuggestions();
  }

  /** Bảng chọn của KHSX: MỌI SKU chưa duyệt + tổ hợp hệ thống đề xuất (để FE tick sẵn). */
  @Get('cutting-batch-candidates')
  @RequirePermissions(VIEW)
  getBatchCandidates() {
    return this.cuttingProposalsService.getBatchCandidates();
  }

  /**
   * Tính thử theo đúng tổ hợp KHSX đang tick. CHỈ ĐỌC dù là POST - dùng POST vì danh sách id có
   * thể dài, không nhét vừa query string một cách an toàn.
   */
  @Post('cutting-batch-preview')
  @RequirePermissions(VIEW)
  previewBatch(@Body() dto: PreviewCuttingBatchDto) {
    return this.cuttingProposalsService.previewBatch(dto);
  }

  @Get('cutting-proposals/:id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.cuttingProposalsService.findOne(id);
  }

  @Post('cutting-proposals/:id/approve')
  @RequirePermissions(APPROVE)
  approve(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.cuttingProposalsService.approve(id, userId);
  }
}
