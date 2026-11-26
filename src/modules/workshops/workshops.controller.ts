import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WorkshopsService } from './workshops.service';

@ApiTags('Workshops')
@ApiBearerAuth()
@Controller({ path: 'workshops', version: '1' })
export class WorkshopsController {
  constructor(private readonly workshopsService: WorkshopsService) {}

  /**
   * Danh mục xưởng đang dùng (id, tên, thứ tự) - dữ liệu tham chiếu ít nhạy cảm, MỌI người dùng đã đăng nhập đều đọc được
   * (JwtAuthGuard toàn cục vẫn bắt đăng nhập). 26/11/2026: trước đây đòi PRODUCTION_INVOICE:VIEW nên tổ trưởng Hàn / Sơn
   * (han, son) bị 403 mỗi lần mở khung Sản xuất. Quyền xem / sửa LỆNH sản xuất không đổi - chỉ danh mục xưởng được mở.
   */
  @Get()
  findAll() {
    return this.workshopsService.findActive();
  }
}
