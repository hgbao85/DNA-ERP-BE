import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

@Exclude()
export class MaterialGroupResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() name!: string;

  constructor(partial: Partial<MaterialGroupResponseDto>) {
    Object.assign(this, partial);
  }
}
