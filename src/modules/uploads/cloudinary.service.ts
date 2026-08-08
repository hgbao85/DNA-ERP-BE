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

  uploadBuffer(buffer: Buffer, folder: string): Promise<string> {
    if (!this.configService.get('cloudinary.cloudName', { infer: true })) {
      throw new InternalServerErrorException(
        'Chưa cấu hình CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET',
      );
    }

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => {
        if (error || !result) {
          reject(new InternalServerErrorException(error?.message ?? 'Upload ảnh thất bại'));
          return;
        }
        resolve(result.secure_url);
      });
      stream.end(buffer);
    });
  }

  /**
   * Xóa ảnh mồ côi (bị thay/gỡ khỏi 1 bản ghi, hoặc bản ghi chứa nó bị xóa) - best-effort,
   * KHÔNG throw: lỗi ở đây (Cloudinary down, URL không thuộc Cloudinary, ảnh đã bị xóa sẵn...)
   * không được phép chặn thao tác chính (update/xóa vật tư) đang gọi hàm này.
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
