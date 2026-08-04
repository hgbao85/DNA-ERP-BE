import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class MaterialResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialGroupId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) khoUnitFactor!: number | null;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<MaterialResponseDto>) {
    Object.assign(this, partial);
  }
}
