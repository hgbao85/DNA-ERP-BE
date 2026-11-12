import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MfgRole } from '../../../generated/prisma/client';

@Exclude()
export class UserResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() username!: string;
  @Expose() @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @Expose() @ApiProperty() firstName!: string;
  @Expose() @ApiProperty() lastName!: string;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;
  @Expose() @ApiProperty({ type: [String] }) roles!: string[];
  @Expose() @ApiPropertyOptional({ enum: MfgRole, nullable: true }) mfgRole!: MfgRole | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseScope!: string | null;
  /** Đợt 7: các kho được đổi qua lại (gồm kho đang làm); [] = chỉ 1 kho. */
  @Expose() @ApiPropertyOptional({ type: [String] }) warehouseScopes!: string[];
  @Expose() @ApiProperty() isPurchaser!: boolean;
  @Expose() @ApiProperty() isProductPlanner!: boolean;
  @Expose() @ApiProperty() isSale!: boolean;
  @Expose() @ApiProperty() isMaterialsManager!: boolean;
  /** Xưởng của tài khoản QLSX (QLSX theo xưởng); null = không giới hạn xưởng. */
  @Expose() @ApiProperty({ type: String, nullable: true }) workshopId!: string | null;
  @Expose() @ApiProperty({ type: String, nullable: true }) workshopName!: string | null;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
