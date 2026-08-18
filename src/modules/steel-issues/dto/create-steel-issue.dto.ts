import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min } from 'class-validator';

export class CreateSteelIssueDto {
  @ApiProperty()
  @IsString()
  pieceId!: string;

  /// Bắt buộc từ khi hỗ trợ mảnh dùng nhiều loại sắt (1 mảnh có thể sinh nhiều dòng kế hoạch,
  /// mỗi dòng 1 vật tư) - trước đây tự suy ra vì mặc định "1 mảnh = 1 loại sắt" không còn đúng.
  @ApiProperty()
  @IsString()
  materialId!: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barLengthMm!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  barCount!: number;
}
