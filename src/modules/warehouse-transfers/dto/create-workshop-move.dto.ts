import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import type { WorkshopMovePart } from '../workshop-move.service';

/** Lập phiếu chuyển hàng của lệnh đổi xưởng (10/11/2026). */
export class CreateWorkshopMoveDto {
  @ApiProperty({ description: 'Lệnh (ProductionInvoice) vừa đổi xưởng' })
  @IsString()
  productionInvoiceId!: string;

  @ApiProperty({ description: 'Kho xưởng cũ đang giữ hàng của lệnh' })
  @IsString()
  fromWarehouseId!: string;

  @ApiProperty({
    enum: ['STEEL', 'OTHER'],
    description:
      'STEEL = sắt (chờ KHSX "Đã kiểm" phương án cắt); OTHER = vật tư khác (chuyển ngay)',
  })
  @IsIn(['STEEL', 'OTHER'])
  part!: WorkshopMovePart;
}
