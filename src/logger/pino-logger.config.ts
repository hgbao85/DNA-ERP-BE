import { Params } from 'nestjs-pino';
import { IncomingMessage } from 'http';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { resolveCorrelationId } from '../common/utils/correlation-id.util';

export function createPinoLoggerOptions(configService: ConfigService<AppConfig, true>): Params {
  const env = configService.get('env', { infer: true });
  const logLevel = configService.get('logLevel', { infer: true });
  const apiPrefix = configService.get('apiPrefix', { infer: true });
  const healthCheckPath = `/${apiPrefix}/health`;

  return {
    pinoHttp: {
      level: logLevel,
      // KHÔNG setHeader ở đây: pino-http chạy sau CorrelationIdMiddleware nên sẽ ghi đè header bằng
      // một UUID khác với cls.getId() (id dùng cho audit log và event realtime). Header x-correlation-id
      // do CorrelationIdMiddleware đặt là nguồn duy nhất.
      genReqId: (req: IncomingMessage) => resolveCorrelationId(req),
      transport:
        env !== 'production'
          ? {
              target: 'pino-pretty',
              options: { singleLine: true, colorize: true },
            }
          : undefined,
      autoLogging: {
        ignore: (req: IncomingMessage) => req.url === healthCheckPath,
      },
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      customProps: () => ({ context: 'HTTP' }),
    },
  };
}
