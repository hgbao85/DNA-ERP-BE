import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Loại dây/nệm Sales đã chọn cho 1 dòng đơn / dòng lệnh sản xuất - đủ để hiển thị (mã SHT, tên,
 *  ảnh mẫu) mà FE không phải tra thêm danh mục vật tư. */
export class MaterialChoiceRefDto {
  @ApiProperty() materialId!: string;
  @ApiProperty() materialCode!: string;
  @ApiProperty() materialName!: string;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
}

export function toMaterialChoiceRef(material: {
  id: bigint;
  code: string;
  name: string;
  imageUrl: string | null;
}): MaterialChoiceRefDto {
  return {
    materialId: material.id.toString(),
    materialCode: material.code,
    materialName: material.name,
    imageUrl: material.imageUrl,
  };
}
