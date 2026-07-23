import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

class PermissionSummaryDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() module!: string;
  @Expose() @ApiProperty() action!: string;
}

@Exclude()
export class RoleResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty({ required: false }) description?: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose() @ApiProperty({ type: [PermissionSummaryDto] }) permissions!: PermissionSummaryDto[];

  constructor(partial: Partial<RoleResponseDto>) {
    Object.assign(this, partial);
  }
}
