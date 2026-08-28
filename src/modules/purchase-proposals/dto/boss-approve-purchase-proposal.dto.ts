import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class BossApprovePurchaseProposalDto {
  @ApiProperty({
    description:
      'URL file phiếu Sếp đã ký tay (Cloudinary secure_url) - lấy từ POST /uploads/document. ' +
      'BẮT BUỘC: đây là bằng chứng duy nhất trong hệ thống cho việc lô hàng đã được duyệt mua.',
    example: 'https://res.cloudinary.com/demo/image/upload/v1/dna-erp/approvals/abc123.jpg',
  })
  @IsString()
  @MinLength(1)
  approvalFileUrl!: string;
}
