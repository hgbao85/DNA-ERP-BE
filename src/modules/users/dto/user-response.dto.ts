import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgRole, PhoiOperation } from '../../../generated/prisma/client';

@Exclude()
export class UserResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() email!: string;
  @Expose() @ApiProperty() firstName!: string;
  @Expose() @ApiProperty() lastName!: string;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose() @ApiProperty({ type: [String] }) roles!: string[];
  @Expose() @ApiPropertyOptional({ enum: MfgRole, nullable: true }) mfgRole!: MfgRole | null;
  @Expose()
  @ApiPropertyOptional({ enum: PhoiOperation, nullable: true })
  phoiOperation!: PhoiOperation | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseScope!: string | null;
  @Expose() @ApiProperty() isPurchaser!: boolean;
  @Expose() @ApiProperty() isProductPlanner!: boolean;
  @Expose() @ApiProperty() isSale!: boolean;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
