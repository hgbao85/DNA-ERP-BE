import { Module } from '@nestjs/common';
import { SkusModule } from '../skus/skus.module';
import { MaterialInspectionController } from './material-inspection.controller';
import { MaterialInspectionService } from './material-inspection.service';

@Module({
  imports: [SkusModule],
  controllers: [MaterialInspectionController],
  providers: [MaterialInspectionService],
  exports: [MaterialInspectionService],
})
export class MaterialInspectionModule {}
