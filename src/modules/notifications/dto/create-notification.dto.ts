import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { NotificationAudience } from '../../../generated/prisma/client';

export class CreateNotificationDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  message!: string;

  @ApiProperty({ enum: NotificationAudience })
  @IsEnum(NotificationAudience)
  audience!: NotificationAudience;
}
