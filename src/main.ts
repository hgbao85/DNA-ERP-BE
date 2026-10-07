import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLogger));
  const configService = app.get(ConfigService<AppConfig, true>);

  const corsOrigin = configService.get('cors.origin', { infer: true });
  app.use(helmet());
  const allowedOrigins: boolean | string[] =
    corsOrigin === '*' ? true : corsOrigin.split(',').map((origin) => origin.trim());
  app.enableCors({ origin: allowedOrigins, credentials: true });
  // Socket.IO dùng cùng danh sách origin với REST - xem realtime-io.adapter.ts.
  const redisUrl = configService.get('realtime.redisUrl', { infer: true });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, allowedOrigins, redisUrl));

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
