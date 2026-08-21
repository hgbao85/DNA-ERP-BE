import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CloudinaryService } from './cloudinary.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Endpoint upload ảnh dùng chung cho mọi form trong app (không riêng module nào) - trả về
 * `imageUrl` (Cloudinary secure_url) để FE tự gắn vào field tương ứng của entity đang sửa.
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
  async uploadImage(@UploadedFile() file?: Express.Multer.File): Promise<{ imageUrl: string }> {
    if (!file) {
      throw new BadRequestException('Thiếu file ảnh (field "file")');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Chỉ chấp nhận ảnh JPEG/PNG/WEBP/GIF');
    }

    const imageUrl = await this.cloudinaryService.uploadBuffer(file.buffer, 'dna-erp');
    return { imageUrl };
  }
}
