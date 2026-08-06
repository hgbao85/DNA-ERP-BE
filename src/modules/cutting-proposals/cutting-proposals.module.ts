import { Module } from '@nestjs/common';
import { ExternalApiModule } from '../external/external-api.module';
import { CuttingProposalsController } from './cutting-proposals.controller';
import { CuttingProposalsService } from './cutting-proposals.service';

@Module({
  imports: [ExternalApiModule],
  controllers: [CuttingProposalsController],
  providers: [CuttingProposalsService],
  exports: [CuttingProposalsService],
})
export class CuttingProposalsModule {}
