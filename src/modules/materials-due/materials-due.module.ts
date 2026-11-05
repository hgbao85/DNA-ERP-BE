import { Module } from '@nestjs/common';
import { MaterialsDueController } from './materials-due.controller';
import { MaterialsDueService } from './materials-due.service';

/**
 * Phần A – Đợt 4 (YC6): màn "Vật tư cần về". CHỈ phụ thuộc Prisma (PrismaModule là global) để WorkQueueModule và DailyJobsModule
 * import được mà không tạo vòng import; đọc SystemConfig bằng prisma trực tiếp. Controller được đăng ký qua module import này
 * (không sửa app.module.ts).
 */
@Module({
  controllers: [MaterialsDueController],
  providers: [MaterialsDueService],
  exports: [MaterialsDueService],
})
export class MaterialsDueModule {}
