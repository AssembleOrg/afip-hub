import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth';
import { AfipModule } from './modules/afip';
import { AuditInterceptor } from './common/interceptors';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    AfipModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
