import { ClassSerializerInterceptor, MiddlewareConsumer, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { Request } from 'express';
import configuration, { AppConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { createPinoLoggerOptions } from './logger/pino-logger.config';
import { resolveCorrelationId } from './common/utils/correlation-id.util';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { MfgRoleGuard } from './common/guards/mfg-role.guard';
import { WarehouseScopeGuard } from './common/guards/warehouse-scope.guard';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { HealthModule } from './modules/health/health.module';
import { ExternalApiModule } from './modules/external/external-api.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SystemConfigModule } from './modules/system-config/system-config.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        // Mounted manually in AppModule.configure() below, immediately followed by
        // CorrelationIdMiddleware, to guarantee the CLS context exists before anything
        // else in the request pipeline tries to read/write it.
        mount: false,
        generateId: true,
        idGenerator: (req: Request) => resolveCorrelationId(req),
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) =>
        createPinoLoggerOptions(configService),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        throttlers: [
          {
            ttl: configService.get('throttle.ttl', { infer: true }) * 1000,
            limit: configService.get('throttle.limit', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    AuditLogModule,
    HealthModule,
    ExternalApiModule,
    NotificationsModule,
    SystemConfigModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: MfgRoleGuard },
    { provide: APP_GUARD, useClass: WarehouseScopeGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClsMiddleware, CorrelationIdMiddleware).forRoutes('*');
  }
}
