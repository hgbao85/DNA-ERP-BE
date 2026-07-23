import { Params } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'http';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { CORRELATION_ID_HEADER } from '../common/middleware/correlation-id.middleware';
import { resolveCorrelationId } from '../common/utils/correlation-id.util';

export function createPinoLoggerOptions(configService: ConfigService<AppConfig, true>): Params {
  const env = configService.get('env', { infer: true });
  const logLevel = configService.get('logLevel', { infer: true });

  return {
    pinoHttp: {
      level: logLevel,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const id = resolveCorrelationId(req);
        res.setHeader(CORRELATION_ID_HEADER, id);
        return id;
      },
      transport:
        env !== 'production'
          ? {
              target: 'pino-pretty',
              options: { singleLine: true, colorize: true },
            }
          : undefined,
      autoLogging: true,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      customProps: () => ({ context: 'HTTP' }),
    },
  };
}
