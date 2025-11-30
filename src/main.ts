import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ResponseInterceptor, HttpExceptionFilter } from './common';
import { JwtAuthGuard } from './common/guards';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const reflector = app.get(Reflector);
  const nodeEnv = configService.get<string>('nodeEnv');
  const swaggerEnabled = configService.get<boolean>('swagger.enabled');
  const swaggerPassword = configService.get<string>('swagger.password');

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix('api');

  // Validation pipe
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

  // Global interceptors
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global guards
  app.useGlobalGuards(new JwtAuthGuard(reflector));

  // Swagger configuration
  if (swaggerEnabled || nodeEnv === 'development') {
    const config = new DocumentBuilder()
      .setTitle('AFIP Hub API')
      .setDescription('API para integración con servicios de AFIP')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Password protection in production
    if (nodeEnv === 'production' && swaggerPassword) {
      app.use('/api/docs', (req: any, res: any, next: any) => {
        if (req.method === 'GET' && req.url === '/api/docs') {
          const auth = req.headers.authorization;
          if (!auth || auth !== `Basic ${Buffer.from(`admin:${swaggerPassword}`).toString('base64')}`) {
            res.setHeader('WWW-Authenticate', 'Basic realm="Swagger"');
            return res.status(401).send('Acceso no autorizado');
          }
        }
        next();
      });
    }

    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
  if (swaggerEnabled || nodeEnv === 'development') {
    console.log(`Swagger documentation: http://localhost:${port}/api/docs`);
  }
}

bootstrap();
