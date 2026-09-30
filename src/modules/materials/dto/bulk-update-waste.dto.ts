import { ArrayMinSize, IsArray, IsOptional, IsNumber, IsString, Max, Min } from 'class-validator';

/**
 * Sửa % hao hụt hàng loạt - đúng 1 trong 2 cách chọn phạm vi:
 *  - `materialIds`: chọn tay từng vật tư (có thể khác nhóm nhau).
 *  - `materialGroupId`: áp dụng cho TOÀN BỘ vật tư đang thuộc 1 nhóm.
 * `value = null` nghĩa là XOÁ % hao hụt hiện có (không phải "giữ nguyên" như PATCH từng vật tư -
 * hành động hàng loạt luôn ghi đè, không có khái niệm "không đụng field" cho field duy nhất này).
 * Field nào (maxCuttingWastePercentage/purchaseWastePercentage) thực sự được ghi tuỳ vào
 * MaterialGroup.systemKey của TỪNG vật tư - xem MaterialsService.resolveWasteFields.
 */
export class BulkUpdateWasteDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  materialIds?: string[];

  @IsOptional()
  @IsString()
  materialGroupId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  value?: number | null;
}
