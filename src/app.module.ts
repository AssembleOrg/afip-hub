import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { SensitiveBodyMiddleware } from './common/middleware/sensitive-body.middleware';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './infra/redis';
import { CertificatesCryptoModule } from './infra/certificates-crypto';
import { StorageModule } from './infra/storage';
import { QueueModule } from './infra/queue';
import { buildLoggerModule } from './infra/observability';
import { AuthModule } from './modules/auth';
import { AfipModule } from './modules/afip';
import { OrganizationsModule } from './modules/organizations';
import { ApiKeysModule } from './modules/api-keys';
import { PlansModule } from './modules/plans';
import { UsageModule } from './modules/usage';
import { ExchangeRateModule } from './modules/exchange-rate';
import { AdminSettingsModule } from './modules/admin-settings';
import { BillingModule } from './modules/billing';
import { InvoicesModule } from './modules/invoices';
import { HealthModule } from './modules/health';
import { EmisoresModule } from './modules/emisores';
import { AddOnsModule } from './modules/addons';
import { VentanillaModule } from './modules/ventanilla';
import { IdempotencyModule } from './modules/idempotency';
import { EmailModule } from './modules/email';
import { AuditModule } from './modules/audit';
import { CertificatesModule } from './modules/certificates';
import { ScheduledTasksModule } from './modules/scheduled-tasks';
import { MetricsModule } from './modules/metrics';
import { NotificationsModule } from './modules/notifications';
import { WebhooksModule } from './modules/webhooks';
import { RetentionModule } from './modules/retention';
import { StorageAlertsModule } from './modules/storage-alerts';
import { SelfBillingModule } from './modules/self-billing';
import { DashboardModule } from './modules/dashboard';
import { PlatformCertModule } from './modules/platform-cert/platform-cert.module';
import {
  AuditInterceptor,
  HttpMetricsInterceptor,
  IdempotencyInterceptor,
  UsageCounterInterceptor,
} from './common/interceptors';
import {
  CuitLimitGuard,
  EmailVerifiedGuard,
  IpRateLimitGuard,
  QuotaGuard,
  SaasAuthGuard,
} from './common/guards';

@Module({
  imports: [
    ConfigModule,
    buildLoggerModule(),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot({
      wildcard: false,
      // En nuestro modelo, cada evento dispara handlers async vía @OnEvent({async:true}).
      maxListeners: 20,
      verboseMemoryLeak: false,
    }),
    DatabaseModule,
    RedisModule,
    CertificatesCryptoModule,
    StorageModule,
    QueueModule.register(),
    EmailModule,
    AuditModule,
    MetricsModule,
    NotificationsModule,
    PlansModule,
    UsageModule,
    ExchangeRateModule,
    AdminSettingsModule,
    ApiKeysModule,
    PlatformCertModule,
    EmisoresModule,
    AddOnsModule,
    VentanillaModule,
    IdempotencyModule,
    OrganizationsModule,
    InvoicesModule,
    BillingModule,
    AuthModule,
    CertificatesModule,
    AfipModule,
    ScheduledTasksModule,
    WebhooksModule,
    RetentionModule,
    StorageAlertsModule,
    SelfBillingModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Guards globales en orden:
    //  1. SaasAuthGuard      → resuelve Public / ApiKey / JWT (puebla req.organization)
    //  2. IpRateLimitGuard   → throttling por IP (auth endpoints)
    //  3. QuotaGuard         → quota del plan + rate-limit PDF/TA
    //  4. CuitLimitGuard     → enforcement de plan.cuitLimit
    //  5. EmailVerifiedGuard → endpoints con @RequireVerified() exigen email verificado
    { provide: APP_GUARD, useClass: SaasAuthGuard },
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: QuotaGuard },
    { provide: APP_GUARD, useClass: CuitLimitGuard },
    { provide: APP_GUARD, useClass: EmailVerifiedGuard },

    // Interceptors globales:
    //  - HttpMetrics: cuenta todo el tráfico HTTP
    //  - Idempotency: antes del handler, short-circuit con replay cacheado
    //  - UsageCounter: registra usage + detecta thresholds 80%/100% → emite eventos
    //  - Audit: log legacy (console)
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: UsageCounterInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SensitiveBodyMiddleware)
      .forRoutes('certificates', 'emisores', 'afip');
  }
}
