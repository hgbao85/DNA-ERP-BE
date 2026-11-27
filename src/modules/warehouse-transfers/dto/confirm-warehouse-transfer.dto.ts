import { IsSystemUploadUrl } from '../../../common/validators/system-upload-url.validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Số thực nhận của 1 dòng phiếu chuyển kho (v8 4.7). */
export class ReceivedLineDto {
  @ApiProperty()
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Số thực nhận (≤ số gửi). Dòng không gửi = nhận đủ.' })
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Số lượng tối đa 4 chữ số thập phân' })
  @Min(0)
  receivedQty!: number;
}

/** Kho nhận xác nhận phiếu chuyển kho: ảnh phiếu đã ký bắt buộc (v8 4.1/4.2) + số thực nhận từng dòng (4.7). */
export class ConfirmWarehouseTransferDto {
  @ApiProperty({ type: [String], description: 'Ảnh phiếu chuyển kho đã ký (ít nhất 1)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  // 20/11 (IT báo): chỉ nhận tệp do chính hệ thống tải lên - gọi thẳng API không xác nhận được phiếu với ảnh giả.
  @IsSystemUploadUrl({ each: true })
  signedSlipUrls!: string[];

  @ApiPropertyOptional({ type: [ReceivedLineDto], description: 'Dòng vật tư' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedLineDto)
  items?: ReceivedLineDto[];

  @ApiPropertyOptional({ type: [ReceivedLineDto], description: 'Dòng mảnh' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivedLineDto)
  pieceItems?: ReceivedLineDto[];
}
