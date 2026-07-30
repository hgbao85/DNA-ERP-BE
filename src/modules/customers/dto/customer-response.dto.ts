import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class CustomerResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) phone!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) email!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) address!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) country!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) market!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) contactName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;

  constructor(partial: Partial<CustomerResponseDto>) {
    Object.assign(this, partial);
  }
}
