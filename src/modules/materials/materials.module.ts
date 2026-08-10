import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module';
import { UploadsModule } from '../uploads/uploads.module';
import { MaterialsController } from './materials.controller';
import { MaterialsService } from './materials.service';

@Module({
  imports: [UploadsModule, StockModule],
  controllers: [MaterialsController],
  providers: [MaterialsService],
  exports: [MaterialsService],
})
export class MaterialsModule {}
