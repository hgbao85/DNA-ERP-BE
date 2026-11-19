import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { NotificationCategory } from '../../../generated/prisma/client';

/** Query của POST /notifications/read-all (19/11/2026): category lạ -> 400 thay vì 500 ở Prisma. */
export class MarkAllReadQueryDto {
  @ApiPropertyOptional({ enum: NotificationCategory, enumName: 'NotificationCategory' })
  @IsOptional()
  @IsEnum(NotificationCategory, {
    message: 'Loại thông báo không hợp lệ (ANNOUNCEMENT, ACTION_REQUIRED, RESULT, ALERT, INFO)',
  })
  category?: NotificationCategory;
}
