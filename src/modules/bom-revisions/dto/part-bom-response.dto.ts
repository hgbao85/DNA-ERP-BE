import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class PartBomResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() partId!: string;
  @Expose() @ApiProperty() partCode!: string;
  @Expose() @ApiProperty() segmentSpecId!: string;
  @Expose() @ApiProperty() segmentSpecLabel!: string;
  @Expose() @ApiProperty() qtyPerPart!: number;

  constructor(partial: Partial<PartBomResponseDto>) {
    Object.assign(this, partial);
  }
}
