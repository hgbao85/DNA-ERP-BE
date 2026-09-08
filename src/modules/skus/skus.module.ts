import { Module } from '@nestjs/common';
import { BomRevisionsModule } from '../bom-revisions/bom-revisions.module';
import { UploadsModule } from '../uploads/uploads.module';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';

@Module({
  imports: [BomRevisionsModule, UploadsModule],
  controllers: [SkusController],
  providers: [SkusService],
  exports: [SkusService],
})
export class SkusModule {}
