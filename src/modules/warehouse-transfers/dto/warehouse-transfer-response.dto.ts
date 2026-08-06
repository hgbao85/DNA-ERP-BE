import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { TransferStatus } from '../../../generated/prisma/client';

@Exclude()
export class WarehouseTransferResponseDto {
  @Expose() @ApiProperty() id!: string;
  @Expose() @ApiProperty() code!: string;
  @Expose() @ApiProperty() fromWarehouseId!: string;
  @Expose() @ApiProperty() fromWarehouseCode!: string;
  @Expose() @ApiProperty() fromWarehouseName!: string;
  @Expose() @ApiProperty() toWarehouseId!: string;
  @Expose() @ApiProperty() toWarehouseCode!: string;
  @Expose() @ApiProperty() toWarehouseName!: string;
  @Expose() @ApiProperty({ enum: TransferStatus }) status!: TransferStatus;
  @Expose() @ApiPropertyOptional({ nullable: true }) planFormId!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectionReason!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) note!: string | null;
  @Expose() @ApiProperty() createdAt!: Date;
  @Expose() @ApiPropertyOptional({ nullable: true }) confirmedAt!: Date | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectedAt!: Date | null;

  constructor(partial: Partial<WarehouseTransferResponseDto>) {
    Object.assign(this, partial);
  }
}
