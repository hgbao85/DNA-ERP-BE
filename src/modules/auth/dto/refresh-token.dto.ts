import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * refreshToken optional: cookie httpOnly `refresh_token` giờ là nguồn chính (browser tự đính
 * kèm), body chỉ còn là fallback cho Swagger "Try it out"/Postman/script không chạy qua cookie.
 */
export class RefreshTokenDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
