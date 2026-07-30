import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class SegmentSpecResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() materialId!: string;
  @Expose() @ApiProperty() materialCode!: string;
  @Expose() @ApiProperty() cutLengthMm!: number;

  constructor(partial: Partial<SegmentSpecResponseDto>) {
    Object.assign(this, partial);
  }
}
