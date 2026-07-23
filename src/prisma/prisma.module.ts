import { Global, Inject, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../common/interfaces/cls-store.interface';
import { createExtendedPrismaClient, PRISMA_SERVICE, PrismaServiceType } from './prisma.service';

@Global()
@Module({
  providers: [
    {
      provide: PRISMA_SERVICE,
      useFactory: (cls: ClsService<AppClsStore>) => createExtendedPrismaClient(cls),
      inject: [ClsService],
    },
  ],
  exports: [PRISMA_SERVICE],
})
export class PrismaModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaServiceType) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
