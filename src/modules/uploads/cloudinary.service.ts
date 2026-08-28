import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfig } from '../../config/configuration';

/** Khớp URL dạng .../upload/[v<version>/]<public_id>.<ext> mà uploadBuffer() tạo ra. */
const PUBLIC_ID_FROM_URL = /\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/;

/**
 * Upload buffer lên Cloudinary. Không cấu hình lưu tạm ra đĩa (memoryStorage ở
 * UploadsController) - file chỉ tồn tại trong RAM đủ lâu để stream thẳng lên Cloudinary.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    cloudinary.config({
      cloud_name: this.configService.get('cloudinary.cloudName', { infer: true }),
      api_key: this.configService.get('cloudinary.apiKey', { infer: true }),
      api_secret: this.configService.get('cloudinary.apiSecret', { infer: true }),
    });
  }

  /**
   * `resourceType` mặc định 'image' - giữ nguyên hành vi cũ cho mọi lời gọi sẵn có. PHẢI truyền
   * 'raw' cho PDF/Excel (POST /uploads/document): Cloudinary mặc định đẩy buffer qua pipeline ảnh,
   * file không phải ảnh sẽ bị từ chối hoặc hỏng.
   */
  uploadBuffer(
    buffer: Buffer,
    folder: string,
    resourceType: 'image' | 'raw' = 'image',
  ): Promise<string> {
    if (!this.configService.get('cloudinary.cloudName', { infer: true })) {
      throw new InternalServerErrorException(
        'Chưa cấu hình CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET',
      );
    }

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: resourceType },
        (error, result) => {
          if (error || !result) {
            reject(new InternalServerErrorException(error?.message ?? 'Upload file thất bại'));
            return;
          }
          resolve(result.secure_url);
        },
      );
      stream.end(buffer);
    });
  }

  /**
   * Xóa ảnh mồ côi (bị thay/gỡ khỏi 1 bản ghi, hoặc bản ghi chứa nó bị xóa) - best-effort,
   * KHÔNG throw: lỗi ở đây (Cloudinary down, URL không thuộc Cloudinary, ảnh đã bị xóa sẵn...)
   * không được phép chặn thao tác chính (update/xóa vật tư) đang gọi hàm này.
   *
   * CHỈ DÙNG ĐƯỢC CHO resource_type='image'. File 'raw' (PDF/Excel qua /uploads/document) sẽ
   * KHÔNG xoá được và thất bại IM LẶNG vì 2 lý do: (1) regex trên cắt mất phần mở rộng, mà
   * public_id của 'raw' lại BAO GỒM nó; (2) destroy() không truyền resource_type nên SDK mặc
   * định 'image'. Cloudinary trả { result: 'not found' } chứ không throw nên catch bên dưới
   * cũng không log gì. Chưa vá vì hiện không có đường xoá/thay file duyệt - ai cần xoá file
   * 'raw' sau này phải sửa cả 2 điểm trên trước.
   */
  async deleteByUrl(url: string): Promise<void> {
    const publicId = PUBLIC_ID_FROM_URL.exec(url)?.[1];
    if (!publicId) return;

    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Không xóa được ảnh Cloudinary "${publicId}": ${reason}`);
    }
  }
}
