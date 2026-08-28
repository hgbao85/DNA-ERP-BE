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
  /** Vấn đề #7 audit 26/08 - trước đây phải tra AuditLog riêng mới biết ai tạo/xác nhận/từ chối.
   *  null với phiếu tạo trước migration này (không backfill). Cùng idiom MaterialIssue.issuedById -
   *  raw id, FE tự resolve tên qua getUsers() như các màn khác đã làm. */
  @Expose() @ApiPropertyOptional({ nullable: true }) createdById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) confirmedById!: string | null;
  @Expose() @ApiPropertyOptional({ nullable: true }) rejectedById!: string | null;

  constructor(partial: Partial<WarehouseTransferResponseDto>) {
    Object.assign(this, partial);
  }
}
