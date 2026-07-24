import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class NotificationReadResponseDto {
  @Expose() @ApiProperty() notificationId!: string;
  @Expose() @ApiProperty() userId!: string;
  @Expose() @ApiProperty() readAt!: Date;

  constructor(partial: Partial<NotificationReadResponseDto>) {
    Object.assign(this, partial);
  }
}
