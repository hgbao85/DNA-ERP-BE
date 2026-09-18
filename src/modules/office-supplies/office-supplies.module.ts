import { Module } from '@nestjs/common';
import { OfficeSuppliesController } from './office-supplies.controller';
import { OfficeSuppliesService } from './office-supplies.service';

@Module({
  controllers: [OfficeSuppliesController],
  providers: [OfficeSuppliesService],
  exports: [OfficeSuppliesService],
})
export class OfficeSuppliesModule {}
