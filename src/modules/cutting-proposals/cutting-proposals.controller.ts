import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  BatchStockLengthsQueryDto,
  PreviewCuttingBatchDto,
} from './dto/cutting-batch-candidate.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { parseBigIntId } from '../../common/utils/parse-bigint-id.util';
import { CuttingProposalsService } from './cutting-proposals.service';
import { RequestCuttingBatchDto } from './dto/request-cutting-batch.dto';

const VIEW = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.CREATE };
const APPROVE = { module: PERMISSION_MODULES.CUTTING_PROPOSAL, action: PermissionAction.APPROVE };

@ApiTags('Cutting Proposals')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CuttingProposalsController {
  constructor(private readonly cuttingProposalsService: CuttingProposalsService) {}

  /**
   * Nút "Tính lại" thủ công - lần tính đầu tiên tự động chạy ngầm khi Sếp duyệt PI item. Tính
   * xong (đầu tiên hay tính lại) đều tự động duyệt luôn (xem CuttingProposalsService.
   * runSolverAndSave/approve) - không cần gọi endpoint approve() dưới đây trong luồng bình
   * thường, endpoint đó chỉ còn là lối thủ công dự phòng khi auto-duyệt lỗi.
   */
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

  /**
   * Nút "Tính lại" cho phiếu GỘP (PI.isMerged) - trước 2026-08-19 KHÔNG tồn tại route này, nên FE
   * gọi nhầm requestProposal() ở trên bằng productionOrderId=null (phương án neo PI gộp không có
   * ProductionOrder riêng) và luôn lỗi. Mirror y hệt requestProposal() cho nhánh PO, chỉ đổi neo.
   */
  @Post('production-invoices/:id/cutting-proposals')
  @RequirePermissions(CREATE)
  requestProposalForInvoice(
    @Param('id') id: string,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.cuttingProposalsService.requestForInvoice(parseBigIntId(id), {
      idempotencyKey,
      requestedById: userId,
    });
  }

  @Get('production-invoices/:id/cutting-proposals')
  @RequirePermissions(VIEW)
  findAllForInvoice(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.cuttingProposalsService.findAllForInvoice(id, query);
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
  getBatchSuggestions(@Query() query: BatchStockLengthsQueryDto) {
    return this.cuttingProposalsService.getBatchSuggestions(query.stockLengthsByMaterial);
  }

  /** Bảng chọn của KHSX: MỌI SKU chưa duyệt + tổ hợp hệ thống đề xuất (để FE tick sẵn). */
  @Get('cutting-batch-candidates')
  @RequirePermissions(VIEW)
  getBatchCandidates(@Query() query: BatchStockLengthsQueryDto) {
    return this.cuttingProposalsService.getBatchCandidates(query.stockLengthsByMaterial);
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

  /**
   * "Tính phương án cắt" (luồng "Solve trước → tạo PI", 2026-09-30): KHSX chạy solver cho tổ hợp SKU
   * đang tick TRƯỚC khi có lệnh sản xuất. Trả ngay proposal CALCULATING, tính nền; kết quả không tự
   * duyệt - KHSX tạo lệnh sản xuất từ đó qua POST /production-invoices/merge | items/:id/claim-solo.
   */
  @Post('cutting-batch-solve')
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  requestBatch(@Body() dto: RequestCuttingBatchDto, @CurrentUser('id') userId: string) {
    return this.cuttingProposalsService.requestForBatch(dto, userId);
  }

  /** Tiến độ + kết quả các lượt tính trước-PI chưa được dùng (KHSX xem ở "Tối ưu cắt sắt"). */
  @Get('cutting-batch-solves')
  @RequirePermissions(VIEW)
  getBatchSolves() {
    return this.cuttingProposalsService.getBatchSolves();
  }

  /** Xoá 1 đợt tính trước-PI chưa dùng khỏi "Kết quả đã tính" (xem discardBatchSolve). */
  @Delete('cutting-batch-solves/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER)
  discardBatchSolve(@Param('id') id: string) {
    return this.cuttingProposalsService.discardBatchSolve(id);
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
