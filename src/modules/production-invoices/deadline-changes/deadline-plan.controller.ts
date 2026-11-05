/**
 * Phần A – Đợt 9 (YC2): API file Excel kế hoạch - xuất / xem trước / xác nhận. Lõi kiểm luật + ghi nằm ở DeadlineChangesPort.
 *
 * XUẤT trả thẳng file nhị phân bằng `@Res()` (ResponseInterceptor toàn cục bọc mọi giá trị trả về thành `{success,data}`, nhưng khi dùng
 * `@Res()` Nest không gửi giá trị trả về nên file không bị bọc). FE đọc tên file ở header Content-Disposition (đã thêm
 * Access-Control-Expose-Headers vì CORS chưa lộ header này).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { PERMISSION_MODULES } from '../../../common/constants/permission-modules.constant';
import { BUSINESS_ROLES, DEFAULT_ROLES } from '../../../common/constants/roles.constant';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireRole } from '../../../common/decorators/require-role.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { PermissionAction } from '../../../generated/prisma/client';
import {
  DEADLINE_FIELDS,
  DeadlineEntryInput,
  DeadlineImportPreview,
  DeadlineSaveResult,
  DeadlineValues,
} from './deadline-changes.types';
import { DeadlineChangesPort } from './deadline-changes.port';
import {
  DeadlinePlanExcelService,
  MAX_PLAN_FILE_BYTES,
  MAX_PLAN_ROWS,
} from './deadline-plan-excel.service';

const VIEW = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.VIEW };
const UPDATE = { module: PERMISSION_MODULES.PRODUCTION_INVOICE, action: PermissionAction.UPDATE };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KEYS = new Set<string>(DEADLINE_FIELDS.map((f) => f.key));

function isRealDay(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    t.getUTCFullYear() === Number(m[1]) &&
    t.getUTCMonth() === Number(m[2]) - 1 &&
    t.getUTCDate() === Number(m[3])
  );
}

/** `{ <khoá mốc>: 'YYYY-MM-DD' | null }` - khoá lạ hoặc ngày không có thật là lỗi. */
function IsDeadlineValues(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDeadlineValues',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} phải là { <mốc>: 'YYYY-MM-DD' } với mốc hợp lệ`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          return Object.entries(value as Record<string, unknown>).every(
            ([k, v]) => KEYS.has(k) && (v === null || isRealDay(v)),
          );
        },
      },
    });
}

export class DeadlineEntryDto implements DeadlineEntryInput {
  @ApiProperty({ description: 'Mã dòng SKU (ProductionInvoiceItem.id)' })
  @IsString()
  @Matches(/^\d+$/, { message: 'itemId phải là chuỗi số' })
  itemId!: string;

  @ApiProperty({ description: "Mốc mới { <khoá>: 'YYYY-MM-DD' }" })
  @IsObject()
  @IsDeadlineValues()
  newValues!: DeadlineValues;

  @ApiProperty({ required: false, description: 'Giá trị lúc xuất file của các khoá đổi' })
  @IsOptional()
  @IsObject()
  @IsDeadlineValues()
  expectedOld?: DeadlineValues;
}

export class CommitDeadlinePlanDto {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ type: [DeadlineEntryDto], maxItems: MAX_PLAN_ROWS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PLAN_ROWS)
  @ValidateNested({ each: true })
  @Type(() => DeadlineEntryDto)
  items!: DeadlineEntryDto[];
}

@ApiTags('Deadline Plan')
@ApiBearerAuth()
@Controller({ path: 'deadline-plan', version: '1' })
export class DeadlinePlanController {
  constructor(
    private readonly excel: DeadlinePlanExcelService,
    private readonly port: DeadlineChangesPort,
  ) {}

  /** Tải file Excel kế hoạch. `scope=all` (mặc định) mọi lệnh chưa Kết thúc · `scope=approved` chỉ dòng đã duyệt. */
  @Get('export')
  @RequirePermissions(VIEW)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN, BUSINESS_ROLES.BOSS)
  async exportPlan(@Query('scope') scope: string | undefined, @Res() res: Response): Promise<void> {
    if (scope !== undefined && scope !== 'all' && scope !== 'approved') {
      throw new BadRequestException("scope chỉ nhận 'all' hoặc 'approved'");
    }
    const { fileName, buffer } = await this.excel.exportPlan(scope ?? 'all');
    res
      .status(200)
      .set({
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(buffer.length),
        'Access-Control-Expose-Headers': 'Content-Disposition',
        'Cache-Control': 'no-store',
      })
      .end(buffer);
  }

  /** Đọc file đã sửa, trả bản xem trước (CHƯA ghi gì). */
  @Post('preview')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PLAN_FILE_BYTES },
    }),
  )
  preview(@UploadedFile() file?: Express.Multer.File): Promise<DeadlineImportPreview> {
    if (!file) throw new BadRequestException('Thiếu file Excel (field "file")');
    if (!/\.xlsx$/i.test(file.originalname ?? '')) {
      throw new BadRequestException('Chỉ nhận file Excel .xlsx');
    }
    return this.excel.preview(file.buffer, file.originalname);
  }

  /** Xác nhận: ghi các dòng của bản xem trước (BE kiểm lại hết). Idempotency-Key bắt buộc - gửi lại cùng khoá không tạo lô thứ 2. */
  @Post('commit')
  @RequirePermissions(UPDATE)
  @RequireRole(BUSINESS_ROLES.PRODUCTION_PLANNER, DEFAULT_ROLES.ADMIN)
  commit(
    @Body() dto: CommitDeadlinePlanDto,
    @CurrentUser() user: AuthenticatedUser,
    @Headers('Idempotency-Key') idempotencyKey: string | undefined,
  ): Promise<DeadlineSaveResult> {
    if (!idempotencyKey?.trim()) {
      throw new BadRequestException('Header Idempotency-Key là bắt buộc');
    }
    return this.port.saveEntries({ id: user.id, roles: user.roles }, dto.items, 'EXCEL', {
      strict: false,
      note: `Excel: ${dto.fileName}`,
      idempotencyKey: idempotencyKey.trim(),
    });
  }
}
