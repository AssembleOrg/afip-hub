import { LoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';

/**
 * Configuración de nestjs-pino. En development usa pretty print, en
 * producción emite JSON línea-por-línea (ingeribe cualquier stack de logs).
 *
 * Redacta headers y body sensibles: `authorization`, `x-api-key`, y los
 * campos `certificado`/`clavePrivada` que aparezcan en el body.
 */
export function buildLoggerModule() {
  const isProd = process.env.NODE_ENV === 'production';

  const params: Params = {
    pinoHttp: {
      level: isProd ? 'info' : 'debug',
      transport: isProd
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              singleLine: true,
              ignore: 'pid,hostname,req,res',
            },
          },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers.cookie',
          'req.body.certificado',
          'req.body.clavePrivada',
          'req.body.password',
        ],
        censor: '[REDACTED]',
      },
      customProps: (req: any) => ({
        orgId: req.organization?.id,
        apiKeyId: req.apiKey?.id,
      }),
    },
  };

  return LoggerModule.forRoot(params);
}
