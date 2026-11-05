import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { LenhCodesService } from './lenh-codes.service';

/**
 * Không gắn @RequirePermissions: mọi tài khoản đã đăng nhập (kể cả tài khoản xưởng) đều thấy mã lệnh
 * trên màn của mình - mã lệnh không phải dữ liệu nhạy cảm, chỉ là cách hiển thị.
 */
@ApiTags('Lenh Codes')
@ApiBearerAuth()
@Controller({ path: 'lenh-codes', version: '1' })
export class LenhCodesController {
  constructor(private readonly lenhCodesService: LenhCodesService) {}

  @Get()
  @ApiQuery({ name: 'codes', description: 'Mã PI, cách nhau bởi dấu phẩy (tối đa 500)' })
  displayCodes(@Query('codes') codes?: string) {
    return this.lenhCodesService.displayCodesByPiCode((codes ?? '').split(','));
  }
}
