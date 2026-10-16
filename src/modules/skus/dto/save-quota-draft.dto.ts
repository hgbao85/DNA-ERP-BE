import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body của PATCH .../manh-quota/draft và .../detail-quota/draft - lưu "nháp" form đang nhập dở
 * (CHƯA gửi phê duyệt) để khôi phục được khi đổi máy/trình duyệt, mất mạng hay sập nguồn giữa
 * chừng (xem PlanForm.manhDraft/detailDraft trong schema). `data` là shape FE tự định hình, CỐ Ý
 * không validate chi tiết (khác hẳn UpdateQuotaDto của endpoint nộp thật) - nháp luôn có thể nửa
 * vời (dòng chưa điền xong số lượng, mảnh chưa có vật tư...), ép đúng shape production sẽ chặn
 * nhầm những lần lưu nháp hợp lệ. Không bao giờ ghi xuống Piece/PieceBom/SegmentSpec thật.
 */
export class SaveQuotaDraftDto {
  @ApiProperty({ description: 'Toàn bộ state form đang nhập dở, JSON tự do (server không parse)' })
  @IsOptional()
  data?: unknown;

  @ApiProperty({ description: 'Tên người đang nhập (hiển thị lại khi khôi phục)' })
  @IsString()
  @MinLength(1)
  savedBy!: string;
}
