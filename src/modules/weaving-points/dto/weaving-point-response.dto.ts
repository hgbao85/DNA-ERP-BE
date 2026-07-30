import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class WeavingPointResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) fullName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) aliasNote!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) dayDaiPercent!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) ketThucPercent!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) hangQuanPercent!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;

  constructor(partial: Partial<WeavingPointResponseDto>) {
    Object.assign(this, partial);
  }
}
