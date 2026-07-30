import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PartResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() mfgProductId!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;

  constructor(partial: Partial<PartResponseDto>) {
    Object.assign(this, partial);
  }
}
