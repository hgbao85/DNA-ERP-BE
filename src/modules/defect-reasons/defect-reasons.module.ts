import { Module } from '@nestjs/common';
import { DefectReasonsController } from './defect-reasons.controller';
import { DefectReasonsService } from './defect-reasons.service';

@Module({
  controllers: [DefectReasonsController],
  providers: [DefectReasonsService],
  exports: [DefectReasonsService],
})
export class DefectReasonsModule {}
