import { Module } from '@nestjs/common';
import { BomRevisionsController, ProductBomRevisionsController } from './bom-revisions.controller';
import { BomRevisionsService } from './bom-revisions.service';

@Module({
  controllers: [BomRevisionsController, ProductBomRevisionsController],
  providers: [BomRevisionsService],
  exports: [BomRevisionsService],
})
export class BomRevisionsModule {}
