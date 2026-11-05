import { Module } from '@nestjs/common';
import { LenhCodesController } from './lenh-codes.controller';
import { LenhCodesService } from './lenh-codes.service';

@Module({
  controllers: [LenhCodesController],
  providers: [LenhCodesService],
})
export class LenhCodesModule {}
