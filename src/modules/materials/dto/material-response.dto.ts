import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { MaterialDetailKind } from '../../../generated/prisma/client';

@Exclude()
export class MaterialResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() name!: string;
  @Expose() @ApiProperty() unit!: string;
  @Expose() @ApiPropertyOptional({ nullable: true }) spec!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) materialGroupId!: string | null;
  /** Denormalized từ MaterialGroup.name - để FE (vd VatTuDashboardPage, dùng bởi WAREHOUSE_STAFF
   *  không có quyền MATERIAL_GROUP:VIEW) lọc/nhóm theo Nhóm vật tư mà không cần gọi riêng
   *  GET /material-groups. */
  @Expose() @ApiPropertyOptional({ nullable: true }) materialGroupName!: string | null;
  @Expose()
  @ApiPropertyOptional({ enum: MaterialDetailKind, nullable: true })
  detailKind!: MaterialDetailKind | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseId!: string | null;
  /** Denormalized từ Warehouse.code/name - cùng lý do materialGroupName ở trên, để FE nhận biết
   *  vật tư thuộc kho nào mà không cần khớp thêm 1 lệnh gọi GET /warehouses theo id. */
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseCode!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) warehouseName!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) buyerId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) purchaseUnit!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) khoUnitFactor!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) maxCuttingWastePercentage!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) purchaseWastePercentage!: number | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @Expose() @ApiProperty() isActive!: boolean;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiProperty() updatedAt!: Date;

  constructor(partial: Partial<MaterialResponseDto>) {
    Object.assign(this, partial);
  }
}
