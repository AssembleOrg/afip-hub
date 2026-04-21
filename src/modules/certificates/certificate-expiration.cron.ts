import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { EVENTS } from '@/common/events';
import type { CertificateExpiringPayload } from '@/common/events';

// Umbrales de alerta en días antes del vencimiento. Mandamos 1 email por
// cruce (via dedupe del NotificationsService), así un cert vencido en 60 días
// dispara emails a los 60, 30, 15, 7, 3 y 1 día antes.
const WARNING_THRESHOLDS_DAYS = [60, 30, 15, 7, 3, 1];

/**
 * Cron diario 9am GMT-3: busca certificados activos cuyo `notAfter` esté
 * dentro del próximo umbral más grande (60 días) y emite un evento por cada
 * cert con los días restantes. El listener filtra por umbral exacto y
 * dedupe vía `NotificationDelivery.dedupeKey`.
 */
@Injectable()
export class CertificateExpirationCron {
  private readonly logger = new Logger(CertificateExpirationCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM, {
    name: 'cert-expiration-check',
    timeZone: 'America/Argentina/Buenos_Aires',
  })
  async daily() {
    const maxDays = Math.max(...WARNING_THRESHOLDS_DAYS);
    const horizon = new Date(Date.now() + maxDays * 24 * 3600 * 1000);

    const expiring = await this.prisma.certificate.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        notAfter: { lte: horizon, gte: new Date() },
      },
      include: {
        organization: { include: { owner: { select: { email: true } } } },
      },
    });

    if (expiring.length === 0) {
      this.logger.debug('No hay certs próximos a vencer en el horizonte de 60 días');
      return;
    }

    this.logger.log(`${expiring.length} cert(s) próximos a vencer`);

    for (const cert of expiring) {
      const daysUntilExpiry = Math.floor(
        (cert.notAfter.getTime() - Date.now()) / (24 * 3600 * 1000),
      );
      if (daysUntilExpiry < 0) continue;

      const payload: CertificateExpiringPayload = {
        organizationId: cert.organizationId,
        certificateId: cert.id,
        cuit: cert.cuit,
        alias: cert.alias,
        notAfter: cert.notAfter,
        daysUntilExpiry,
      };
      this.events.emit(EVENTS.CERTIFICATE_EXPIRING, payload);
    }
  }
}
