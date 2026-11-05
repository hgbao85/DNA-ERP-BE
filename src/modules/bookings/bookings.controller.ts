import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionAction } from '../../generated/prisma/client';
import { PERMISSION_MODULES } from '../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../common/constants/roles.constant';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { BookingsService } from './bookings.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingCandidatesQueryDto, BookingQueryDto } from './dto/booking-query.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

const VIEW = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.VIEW };
const CREATE = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.CREATE };
const UPDATE = { module: PERMISSION_MODULES.SALES_ORDER, action: PermissionAction.UPDATE };

/**
 * Phần A – Đợt 10a (YC5): Booking / Lịch xuất hàng. Ghi: chỉ Sales + Admin (WAREHOUSE_STAFF cũng có SALES_ORDER:UPDATE nên phải
 * chặn thêm theo vai trò - plan V4-20). Route tĩnh khai TRƯỚC `:id`.
 */
@ApiTags('Bookings')
@ApiBearerAuth()
@Controller({ path: 'bookings', version: '1' })
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @RequirePermissions(VIEW)
  findAll(@Query() query: BookingQueryDto) {
    return this.bookingsService.findAll(query);
  }

  @Get('meta')
  @RequirePermissions(VIEW)
  getMeta() {
    return this.bookingsService.getMeta();
  }

  @Get('candidates')
  @RequirePermissions(VIEW)
  getCandidates(@Query() query: BookingCandidatesQueryDto) {
    return this.bookingsService.getCandidates(query);
  }

  @Get(':id')
  @RequirePermissions(VIEW)
  findOne(@Param('id') id: string) {
    return this.bookingsService.findOne(id);
  }

  @Post()
  @RequirePermissions(CREATE)
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  create(@Body() dto: CreateBookingDto) {
    return this.bookingsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookingsService.update(id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  confirm(@Param('id') id: string) {
    return this.bookingsService.confirm(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.SALES_STAFF, DEFAULT_ROLES.ADMIN)
  cancel(@Param('id') id: string, @Body() dto: CancelBookingDto) {
    return this.bookingsService.cancel(id, dto);
  }
}
