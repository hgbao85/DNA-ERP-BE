import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreatePieceMaterialYieldDto {
  @ApiProperty({
    description:
      'Phải cùng mfg_product với bom_revision, và đã có bom_piece trên revision này (kiểm ở service) - không ràng buộc needsHan',
  })
  @IsString()
  pieceId!: string;

  @ApiProperty({ description: 'Nguyên liệu thô cắt ra piece này (vd thanh nhôm)' })
  @IsString()
  materialId!: string;

  @ApiProperty({
    description: 'Số vật tư thành phẩm cắt được từ 1 đơn vị material (vd 1 cây = 12 chân)',
  })
  @IsInt()
  @Min(1)
  piecesPerBar!: number;
}
