import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { PRISMA_SERVICE, PrismaServiceType } from './prisma/prisma.service';
import { syncRbac } from './common/rbac/sync-rbac';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));
  const configService = app.get(ConfigService<AppConfig, true>);

  // Keeps Permission/Role/RolePermission in the DB always matching role-permissions.constant.ts,
  // on every boot - so editing that file takes effect immediately without anyone needing to
  // remember `npm run seed` (see src/common/rbac/sync-rbac.ts for the incident this fixes).
  await syncRbac(app.get<PrismaServiceType>(PRISMA_SERVICE));

  const corsOrigin = configService.get('cors.origin', { infer: true });
  app.use(helmet());
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  const apiPrefix = configService.get('apiPrefix', { infer: true });
  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (configService.get('env', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('DNA ERP API')
      .setDescription('DNA ERP backend API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, swaggerDocument);
  }

  app.enableShutdownHooks();

  const port = configService.get('port', { infer: true });
  await app.listen(port);
  Logger.log(`Application listening on port ${port} (prefix: /${apiPrefix})`, 'Bootstrap');
}

void bootstrap();
