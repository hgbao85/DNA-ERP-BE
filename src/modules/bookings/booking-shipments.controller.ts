import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BookingShipmentsService } from './booking-shipments.service';
import { ReserveShipSlipCodeDto, ShipBookingDto } from './dto/ship-booking.dto';

const VIEW = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE };

/** Người B – Đợt 10b (YC5 5.5–5.7): thủ kho thành phẩm xuất hàng theo booking. Chỉ thủ kho + Admin ghi. */
@ApiTags('Booking Shipments')
@ApiBearerAuth()
@Controller({ path: 'booking-shipments', version: '1' })
export class BookingShipmentsController {
  constructor(private readonly shipments: BookingShipmentsService) {}

  /** Booking đã xác nhận cần đóng cont ở kho mình. */
  @Get()
  @RequirePermissions(VIEW)
  list(@CurrentUser('warehouseScope') scope: string | null) {
    return this.shipments.listToShip(scope);
  }

  /** Giữ số phiếu XK để in trước khi xác nhận xuất. */
  @Post('slip-code')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  reserveSlipCode(@Body() dto: ReserveShipSlipCodeDto, @CurrentUser('id') userId: string) {
    return this.shipments.reserveSlipCode(userId, dto.reuse);
  }

  /** Xác nhận đã xuất (đóng cont xong). Idempotency-Key bắt buộc. */
  @Post(':id/ship')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.WAREHOUSE_STAFF, DEFAULT_ROLES.ADMIN)
  ship(
    @Param('id') id: string,
    @Body() dto: ShipBookingDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('warehouseScope') scope: string | null,
  ) {
    if (!idempotencyKey) throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    return this.shipments.ship(id, dto, userId, scope, idempotencyKey);
  }
}
