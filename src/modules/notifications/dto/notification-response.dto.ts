import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { NotificationAudience } from '../../../generated/prisma/client';

@Exclude()
export class NotificationResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() title!: string;
  @Expose() @ApiProperty() message!: string;
  @Expose() @ApiProperty({ enum: NotificationAudience }) audience!: NotificationAudience;
  @Expose() @ApiProperty({ nullable: true }) createdBy!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() isRead!: boolean;

  constructor(partial: Partial<NotificationResponseDto>) {
    Object.assign(this, partial);
  }
}
