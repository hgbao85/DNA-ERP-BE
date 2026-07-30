import { Module } from '@nestjs/common';
import { MaterialGroupsController } from './material-groups.controller';
import { MaterialGroupsService } from './material-groups.service';

@Module({
  controllers: [MaterialGroupsController],
  providers: [MaterialGroupsService],
  exports: [MaterialGroupsService],
})
export class MaterialGroupsModule {}
