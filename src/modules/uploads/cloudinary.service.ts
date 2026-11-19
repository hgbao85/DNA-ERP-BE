import { Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { AppConfig } from '../../config/configuration';
import { PRISMA_SERVICE, PrismaServiceType } from '../../prisma/prisma.service';

/** Khớp URL dạng .../upload/[v<version>/]<public_id>.<ext> mà uploadBuffer() tạo ra (resource_type
 *  'image' - Cloudinary tự bỏ phần mở rộng khỏi public_id cho ảnh). */
const PUBLIC_ID_FROM_URL = /\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/;
/** Cùng URL nhưng cho resource_type 'raw' (PDF/Excel) - Cloudinary GIỮ NGUYÊN phần mở rộng trong
 *  public_id cho loại 'raw', khác hẳn 'image' ở trên - không được cắt đuôi như nhánh ảnh. */
const PUBLIC_ID_FROM_URL_RAW = /\/upload\/(?:v\d+\/)?(.+)$/;
/** Thư mục gốc mọi file do hệ thống tải lên (POST /uploads/image, /uploads/document) - chỉ xoá file trong đây. */
const OWN_FOLDER = 'dna-erp/';
/** Cột JSON có thể chứa URL ảnh (định mức SKU nháp/đã nộp, đính kèm, bằng chứng ghi đè solver) - quét thêm ngoài
 *  các cột tên có "url". Cột lịch sử/audit cố ý không quét (lịch sử không được ngăn dọn file). */
const JSON_COLUMNS_WITH_URLS = [
  'manhData',
  'manhDraft',
  'detailQuota',
  'detailDraft',
  'attachments',
  'solverOverrideEvidence',
];
type UrlColumn = { t: string; c: string; k: string };

/**
 * Upload buffer lên Cloudinary. Không cấu hình lưu tạm ra đĩa (memoryStorage ở
 * UploadsController) - file chỉ tồn tại trong RAM đủ lâu để stream thẳng lên Cloudinary.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  private urlColumns: Promise<UrlColumn[]> | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType,
  ) {
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
   * `resourceType` mặc định 'image' - giữ nguyên hành vi cũ cho mọi lời gọi sẵn có (Material/SKU/
   * QcReview...). Truyền 'raw' cho file PDF/Excel (POST /uploads/document, vd
   * PurchaseProposalItem.approvalFileUrl) - 2026-09-11, vá lại theo đúng 2 điểm mà bản trước tự ghi
   * chú "chưa vá": (1) public_id của 'raw' BAO GỒM cả phần mở rộng (không cắt như nhánh 'image'),
   * (2) destroy() giờ truyền đúng resource_type thay vì để SDK mặc định 'image' - trước đây gọi sai
   * loại khiến Cloudinary âm thầm trả { result: 'not found' }, không xóa được gì.
   */
  async deleteByUrl(url: string, resourceType: 'image' | 'raw' = 'image'): Promise<void> {
    // BM1 19/11: URL có thể do client gửi (vd imageUrl lúc tạo vật tư) - chỉ xoá file đúng tài khoản Cloudinary của
    // hệ thống, đúng thư mục dna-erp/, và KHÔNG còn bản ghi nào trỏ tới. Trước đây chỉ cắt public_id rồi destroy, nên
    // gửi URL ảnh phiếu Sếp ký của lệnh khác là xoá mất chứng từ duy nhất.
    const cloudName = this.configService.get('cloudinary.cloudName', { infer: true });
    const prefix = `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/`;
    if (!cloudName || !url.startsWith(prefix)) return;
    const publicId =
      resourceType === 'raw'
        ? PUBLIC_ID_FROM_URL_RAW.exec(url)?.[1]
        : PUBLIC_ID_FROM_URL.exec(url)?.[1];
    if (!publicId || !publicId.startsWith(OWN_FOLDER) || publicId.includes('..')) return;

    try {
      if (await this.isReferenced(url)) {
        this.logger.log(`Giữ ảnh Cloudinary "${publicId}": vẫn còn bản ghi dùng`);
        return;
      }
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Không xóa được ảnh Cloudinary "${publicId}": ${reason}`);
    }
  }

  /** Còn cột nào (tên chứa "url" kiểu chuỗi / mảng chuỗi, hoặc cột JSON trong JSON_COLUMNS_WITH_URLS) trỏ tới URL này
   *  không. Danh sách cột đọc từ information_schema 1 lần / tiến trình - bảng mới thêm cột ảnh tự được quét. Lỗi thì
   *  ném lên để deleteByUrl bỏ qua (không chắc thì không xoá). */
  private async isReferenced(url: string): Promise<boolean> {
    this.urlColumns ??= this.prisma.$queryRaw<UrlColumn[]>`
      SELECT table_name AS t, column_name AS c, data_type AS k
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (column_name ILIKE '%url%' AND data_type IN ('text', 'character varying', 'ARRAY'))
          OR (data_type IN ('json', 'jsonb') AND column_name = ANY(${JSON_COLUMNS_WITH_URLS}))
        )`;
    let columns: UrlColumn[];
    try {
      columns = await this.urlColumns;
    } catch (e) {
      this.urlColumns = null;
      throw e;
    }
    for (const { t, c, k } of columns) {
      const col = `"${c.replace(/"/g, '""')}"`;
      const table = `"${t.replace(/"/g, '""')}"`;
      const where =
        k === 'ARRAY'
          ? `$1 = ANY(${col})`
          : k === 'json' || k === 'jsonb'
            ? `strpos(${col}::text, $1) > 0`
            : `${col} = $1`;
      const hit = await this.prisma.$queryRawUnsafe<unknown[]>(
        `SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`,
        url,
      );
      if (hit.length > 0) return true;
    }
    return false;
  }
}
