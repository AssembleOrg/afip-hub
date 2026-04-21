import 'reflect-metadata';
import { validateEnv } from './config/env.validator';
validateEnv();
// OTel DEBE inicializarse antes que cualquier otra lib. Los instrumentations
// monkey-patch módulos al import (http, express, pg, etc.), si cargan antes
// no van a ver esos imports posteriores.
import { initTracing } from './infra/observability/tracing';
initTracing();
import { initSentry, Sentry } from './infra/observability/sentry';
initSentry();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, VersioningType, VERSION_NEUTRAL } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import type { RequestHandler } from 'express';
import { AppModule } from './app.module';
import { ResponseInterceptor, HttpExceptionFilter } from './common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('nodeEnv');
  const isProd = nodeEnv === 'production';
  const swaggerEnabled = configService.get<boolean>('swagger.enabled');
  const swaggerPassword = configService.get<string>('swagger.password');
  const corsOrigins = configService.get<string[]>('cors.origins') ?? [];

  // CORS: en prod usamos whitelist (env validator ya garantiza que existe).
  // En dev, sin whitelist = abierto para facilitar localhost:NNNN del frontend.
  app.enableCors({
    origin: isProd && corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  // SaasAuthGuard, QuotaGuard, IpRateLimitGuard, CuitLimitGuard y los
  // interceptors (Idempotency, UsageCounter, Audit) se registran vía
  // APP_GUARD/APP_INTERCEPTOR en AppModule (necesitan DI completo).

  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason);
  });
  process.on('uncaughtException', (err) => {
    Sentry.captureException(err);
  });

  if (swaggerEnabled || nodeEnv === 'development') {
    const config = new DocumentBuilder()
      .setTitle('AFIP Hub API')
      .setDescription(
        'API SaaS para integración con AFIP (multi-tenant + billing)',
      )
      .setVersion('3.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
      .build();

    const document = SwaggerModule.createDocument(app, config);

    if (isProd && swaggerPassword) {
      const swaggerBasicToken = Buffer.from(
        `admin:${swaggerPassword}`,
      ).toString('base64');
      const expectedAuth = `Basic ${swaggerBasicToken}`;
      const docsAuthMiddleware: RequestHandler = (req, res, next) => {
        const isDocsIndexRequest =
          req.method === 'GET' &&
          (req.originalUrl === '/api/docs' || req.originalUrl === '/api/docs/');
        if (isDocsIndexRequest) {
          const auth = req.headers.authorization;
          if (!auth || auth !== expectedAuth) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Swagger"');
            res.status(401).send('Acceso no autorizado');
            return;
          }
        }
        next();
      };
      app.use('/api/docs', docsAuthMiddleware);
    }

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown — drena requests en vuelo antes de cerrar.
  app.enableShutdownHooks();

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`API running on http://localhost:${port}`);
  if (corsOrigins.length > 0) {
    logger.log(`CORS whitelist: ${corsOrigins.join(', ')}`);
  } else if (isProd) {
    logger.warn(
      'CORS sin whitelist en prod — env validator debería haber bloqueado',
    );
  } else {
    logger.log('CORS abierto (modo dev)');
  }
  if (swaggerEnabled || nodeEnv === 'development') {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}

void bootstrap().catch((err: unknown) => {
  Sentry.captureException(err);
});
