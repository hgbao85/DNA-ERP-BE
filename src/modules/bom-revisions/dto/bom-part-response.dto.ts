import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class BomPartResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() bomRevisionId!: string;
  @Expose() @ApiProperty() partId!: string;
  @Expose() @ApiProperty() partCode!: string;
  @Expose() @ApiProperty() qtyPerUnit!: number;

  constructor(partial: Partial<BomPartResponseDto>) {
    Object.assign(this, partial);
  }
}
