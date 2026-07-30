import { Module } from '@nestjs/common';
import { WeavingPointsController } from './weaving-points.controller';
import { WeavingPointsService } from './weaving-points.service';

@Module({
  controllers: [WeavingPointsController],
  providers: [WeavingPointsService],
  exports: [WeavingPointsService],
})
export class WeavingPointsModule {}
