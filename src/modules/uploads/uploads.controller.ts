import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { BUSINESS_ROLES } from '../../common/constants/roles.constant';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CloudinaryService } from './cloudinary.service';
import { contentMatchesDeclaredType } from './file-signature.util';

/**
 * B5 (17/11): tài khoản CHỈ là công nhân xưởng (đăng nhập PIN ở máy quét QR) không có màn nào upload - chặn để tài khoản
 * dùng chung trên xưởng không đẩy được file lên kho lưu trữ. Mọi vai trò nghiệp vụ khác giữ nguyên (KCS, kho, mua hàng,
 * Sales, định mức, KHSX, Admin... đều có màn upload).
 */
function assertMayUpload(user: AuthenticatedUser | undefined): void {
  const roles = user?.roles ?? [];
  if (roles.length > 0 && roles.every((r) => r === BUSINESS_ROLES.FLOOR_WORKER)) {
    throw new ForbiddenException('Tài khoản công nhân xưởng không tải file lên được');
  }
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/// Phiếu duyệt của Sếp là bản in KÝ TAY rồi chụp/scan - thực tế ra ảnh điện thoại (vài MB) hoặc
/// PDF scan nhiều trang, nên trần rộng hơn ảnh thường.
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  ...ALLOWED_MIME_TYPES,
  'application/pdf',
  'application/vnd.ms-excel', // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
]);

/**
 * Endpoint upload dùng chung cho mọi form trong app (không riêng module nào) - trả về URL
 * (Cloudinary secure_url) để FE tự gắn vào field tương ứng của entity đang sửa.
 */
@ApiTags('Uploads')
@ApiBearerAuth()
@Controller({ path: 'uploads', version: '1' })
export class UploadsController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Post('image')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  async uploadImage(
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ imageUrl: string }> {
    assertMayUpload(user);
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh (field "file")');
    }
    if (
      !ALLOWED_MIME_TYPES.has(file.mimetype) ||
      !contentMatchesDeclaredType(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException('Chỉ chấp nhận ảnh JPEG/PNG/WEBP/GIF');
    }

    const imageUrl = await this.cloudinaryService.uploadBuffer(file.buffer, 'dna-erp');
    return { imageUrl };
  }

  /**
   * Tài liệu đính kèm (ảnh + PDF + Excel) - hiện dùng cho phiếu Sếp đã ký ở luồng duyệt mua hàng
   * (2026-08-27, xem PurchaseProposalsService.bossApprove).
   *
   * Tách khỏi /uploads/image thay vì nới allowlist của nó: 4 màn khác đang dùng route kia và cần
   * giữ contract CHỈ-ẢNH cho chặt (chúng render thẳng vào <img>, nhận PDF vào là hỏng giao diện).
   */
  @Post('document')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES },
    }),
  )
  async uploadDocument(
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ fileUrl: string }> {
    assertMayUpload(user);
    if (!file) {
      throw new BadRequestException('Thiếu file (field "file")');
    }
    if (
      !ALLOWED_DOCUMENT_MIME_TYPES.has(file.mimetype) ||
      !contentMatchesDeclaredType(file.buffer, file.mimetype)
    ) {
      throw new BadRequestException('Chỉ chấp nhận ảnh (JPEG/PNG/WEBP/GIF), PDF hoặc Excel');
    }

    // PDF/Excel PHẢI đi resource_type='raw' - pipeline ảnh của Cloudinary từ chối/làm hỏng chúng.
    const isImage = ALLOWED_MIME_TYPES.has(file.mimetype);
    const fileUrl = await this.cloudinaryService.uploadBuffer(
      file.buffer,
      'dna-erp/approvals',
      isImage ? 'image' : 'raw',
    );
    return { fileUrl };
  }
}
