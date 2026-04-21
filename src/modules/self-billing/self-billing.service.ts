import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { AfipService } from '@/modules/afip/afip.service';
import { AdminSettingsService } from '@/modules/admin-settings/admin-settings.service';
import { CertificatesService } from '@/modules/certificates/certificates.service';
import { AuditService } from '@/modules/audit/audit.service';
import { formatLocal, toAfipDate, toAppZone } from '@/common/utils/clock';
import {
  AuditActor,
  PaymentStatus,
  PlatformInvoiceStatus,
} from '../../../generated/prisma';
import {
  CondicionIvaReceptor,
  Concepto,
  TipoComprobante,
} from '@/modules/afip/dto/create-invoice.dto';

interface PlatformBillingSettings {
  enabled: boolean;
  certificateId: string;
  puntoVenta: number;
  tipoComprobanteDefault: number;
  homologacion: boolean;
  conceptoTemplate: string;
  maxRetries: number;
}

@Injectable()
export class SelfBillingService {
  private readonly logger = new Logger(SelfBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly afip: AfipService,
    private readonly adminSettings: AdminSettingsService,
    private readonly certificates: CertificatesService,
    private readonly audit: AuditService,
  ) {}

  /** Se llama desde el listener de PAYMENT_APPROVED. */
  async issueForPayment(paymentId: string): Promise<void> {
    // Idempotency: si ya existe una PlatformInvoice en estado EMITTED, no tocamos.
    const existing = await this.prisma.platformInvoice.findUnique({
      where: { paymentId },
    });
    if (existing?.status === PlatformInvoiceStatus.EMITTED) {
      this.logger.debug(`Payment ${paymentId} ya tiene PlatformInvoice EMITTED, skip`);
      return;
    }

    const settings = await this.loadSettings();
    const pi = existing
      ? existing
      : await this.prisma.platformInvoice.create({
          data: { paymentId, status: PlatformInvoiceStatus.PENDING },
        });

    // Early-exit checks que solo cambian status, no gastan recursos:
    if (!settings.enabled) {
      await this.markSkipped(pi.id, 'platform_billing.enabled = false');
      return;
    }
    if (!settings.certificateId) {
      await this.markSkipped(pi.id, 'platform_billing.certificate_id vacío');
      return;
    }

    await this.attemptEmit(pi.id, settings);
  }

  /** Retry manual de una PlatformInvoice (admin endpoint o cron). */
  async retry(platformInvoiceId: string): Promise<void> {
    const pi = await this.prisma.platformInvoice.findUnique({
      where: { id: platformInvoiceId },
    });
    if (!pi) return;
    if (pi.status === PlatformInvoiceStatus.EMITTED) return;

    const settings = await this.loadSettings();
    if (!settings.enabled || !settings.certificateId) {
      this.logger.warn(
        `Retry de ${platformInvoiceId} pero self-billing no está configurado`,
      );
      return;
    }

    await this.attemptEmit(pi.id, settings);
  }

  private async attemptEmit(
    platformInvoiceId: string,
    settings: PlatformBillingSettings,
  ): Promise<void> {
    const pi = await this.prisma.platformInvoice.findUnique({
      where: { id: platformInvoiceId },
      include: {
        payment: {
          include: {
            subscription: {
              include: {
                plan: true,
                organization: {
                  include: {
                    owner: { select: { email: true } },
                    emisores: {
                      where: { deletedAt: null },
                      take: 1,
                      orderBy: { lastSeenAt: 'desc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!pi) return;

    const payment = pi.payment;
    if (payment.status !== PaymentStatus.APPROVED) {
      await this.markSkipped(pi.id, `payment.status=${payment.status} (no APPROVED)`);
      return;
    }

    const attempts = pi.attempts + 1;

    try {
      // 1) Resolver cert de la plataforma desde el storage cifrado.
      const platformCert = await this.prisma.certificate.findUnique({
        where: { id: settings.certificateId },
      });
      if (!platformCert) {
        throw new Error(
          `Certificate ${settings.certificateId} no existe. Creá uno nuevo via POST /certificates y actualizá platform_billing.certificate_id.`,
        );
      }
      const material = await this.certificates.resolveMaterial(
        platformCert.organizationId,
        settings.certificateId,
      );

      // 2) Determinar receptor: CUIT del cliente o consumidor final
      const sub = payment.subscription;
      const org = sub.organization;
      const receptorCuit = org.emisores[0]?.cuit ?? null;

      const isConsumidorFinal = !receptorCuit;
      const tipoComprobante = isConsumidorFinal
        ? settings.tipoComprobanteDefault
        : TipoComprobante.FACTURA_A;
      const condicionIvaReceptor = isConsumidorFinal
        ? CondicionIvaReceptor.CONSUMIDOR_FINAL
        : CondicionIvaReceptor.IVA_RESPONSABLE_INSCRIPTO;

      // 3) Build body de la factura.
      // Asumimos: amountArs es el TOTAL final al consumidor. En Factura B el
      // IVA va incluido (no se discrimina). En Factura A hay que separar.
      // Conservador: mandamos todo como importeNetoGravado, sin IVA separado.
      // Si el admin quiere Factura A con IVA discriminado, que ajuste el plan.
      const totalArs = Number(payment.amountArs);

      const concepto = settings.conceptoTemplate
        .replace('{planName}', sub.plan.name)
        .replace(
          '{period}',
          `${formatLocal(payment.periodStart, 'date')} al ${formatLocal(payment.periodEnd, 'date')}`,
        );

      const invoiceRequest: any = {
        puntoVenta: settings.puntoVenta,
        tipoComprobante,
        fechaComprobante: toAfipDate(toAppZone(new Date())),
        cuitCliente: receptorCuit ?? '0',
        tipoDocumento: isConsumidorFinal ? 99 : 80, // 99=otro, 80=CUIT
        condicionIvaReceptor,
        concepto: Concepto.SERVICIOS,
        importeNetoGravado: isConsumidorFinal ? 0 : totalArs / 1.21,
        importeNetoNoGravado: 0,
        importeExento: 0,
        importeIva: isConsumidorFinal ? 0 : totalArs - totalArs / 1.21,
        importeTributos: 0,
        importeTotal: totalArs,
        iva: isConsumidorFinal
          ? undefined
          : [
              {
                Id: 5,
                BaseImp: totalArs / 1.21,
                Importe: totalArs - totalArs / 1.21,
              },
            ],
        conceptoDescripcion: concepto,
        cuitEmisor: material.cuit,
        certificado: material.certificate,
        clavePrivada: material.privateKey,
        homologacion: settings.homologacion,
      };

      // 4) Emitir en AFIP.
      const response = await this.afip.createInvoice(invoiceRequest);
      if (response.resultado !== 'A' || !response.cae) {
        throw new Error(
          `AFIP rechazó la emisión: ${JSON.stringify(response.observaciones ?? response)}`,
        );
      }

      // 5) Guardar resultado.
      await this.prisma.platformInvoice.update({
        where: { id: pi.id },
        data: {
          status: PlatformInvoiceStatus.EMITTED,
          attempts,
          lastAttemptAt: new Date(),
          emittedAt: new Date(),
          cae: response.cae,
          caeVencimiento: this.parseYYYYMMDD(response.caeFchVto),
          puntoVenta: response.puntoVenta,
          tipoComprobante: response.tipoComprobante,
          numeroComprobante: BigInt(response.numeroComprobante),
          fechaComprobante: this.parseYYYYMMDD(response.fechaComprobante),
          cuitEmisor: material.cuit,
          cuitReceptor: receptorCuit,
          homologacion: settings.homologacion,
          error: null,
        },
      });

      void this.audit.record({
        actorType: AuditActor.SYSTEM,
        organizationId: org.id,
        action: 'platform_invoice.emitted',
        severity: 'info',
        targetType: 'platform_invoice',
        targetId: pi.id,
        metadata: {
          cae: response.cae,
          puntoVenta: response.puntoVenta,
          numeroComprobante: String(response.numeroComprobante),
          amountArs: totalArs,
          paymentId: payment.id,
        },
      });

      this.logger.log(
        `Self-billing OK: payment=${payment.id} CAE=${response.cae} nro=${response.puntoVenta}-${response.numeroComprobante}`,
      );
    } catch (err) {
      const errMsg = String((err as Error).message ?? err).slice(0, 1000);
      const isAbandoned = attempts >= settings.maxRetries;

      await this.prisma.platformInvoice.update({
        where: { id: pi.id },
        data: {
          status: isAbandoned
            ? PlatformInvoiceStatus.ABANDONED
            : PlatformInvoiceStatus.FAILED,
          attempts,
          lastAttemptAt: new Date(),
          error: errMsg,
        },
      });

      this.logger.error(
        `Self-billing FALLÓ (attempt ${attempts}/${settings.maxRetries}) payment=${payment.id}: ${errMsg}`,
      );

      if (isAbandoned) {
        void this.audit.record({
          actorType: AuditActor.SYSTEM,
          organizationId: payment.subscription.organizationId,
          action: 'platform_invoice.abandoned',
          severity: 'error',
          targetType: 'platform_invoice',
          targetId: pi.id,
          metadata: { attempts, lastError: errMsg.slice(0, 300) },
        });
      }
    }
  }

  /**
   * Cron llama esto: busca PlatformInvoice FAILED/PENDING que no estén en
   * maxRetries, las reintenta con backoff natural (la llamada AFIP es pesada
   * así que el cron diario es suficiente).
   */
  async processRetries(max = 20): Promise<{ retried: number }> {
    const settings = await this.loadSettings();
    if (!settings.enabled || !settings.certificateId) {
      return { retried: 0 };
    }
    const candidates = await this.prisma.platformInvoice.findMany({
      where: {
        status: { in: [PlatformInvoiceStatus.FAILED, PlatformInvoiceStatus.PENDING] },
        attempts: { lt: settings.maxRetries },
      },
      take: max,
      orderBy: { createdAt: 'asc' },
    });

    for (const pi of candidates) {
      await this.attemptEmit(pi.id, settings).catch((e) =>
        this.logger.error(`Retry inesperadamente falló ${pi.id}: ${String(e)}`),
      );
    }
    return { retried: candidates.length };
  }

  private async markSkipped(id: string, reason: string): Promise<void> {
    await this.prisma.platformInvoice.update({
      where: { id },
      data: {
        status: PlatformInvoiceStatus.SKIPPED,
        error: reason.slice(0, 1000),
        lastAttemptAt: new Date(),
      },
    });
    this.logger.warn(`PlatformInvoice ${id} SKIPPED: ${reason}`);
  }

  private async loadSettings(): Promise<PlatformBillingSettings> {
    const [
      enabled,
      certificateId,
      puntoVenta,
      tipoDefault,
      homologacion,
      template,
      maxRetries,
    ] = await Promise.all([
      this.adminSettings.get<boolean>('platform_billing.enabled', false),
      this.adminSettings.get<string>('platform_billing.certificate_id', ''),
      this.adminSettings.get<number>('platform_billing.punto_venta', 1),
      this.adminSettings.get<number>('platform_billing.tipo_comprobante_default', 6),
      this.adminSettings.get<boolean>('platform_billing.homologacion', true),
      this.adminSettings.get<string>('platform_billing.concepto_template', 'Suscripción {planName}'),
      this.adminSettings.get<number>('platform_billing.max_retries', 5),
    ]);
    return {
      enabled: enabled ?? false,
      certificateId: certificateId ?? '',
      puntoVenta: puntoVenta ?? 1,
      tipoComprobanteDefault: tipoDefault ?? 6,
      homologacion: homologacion ?? true,
      conceptoTemplate: template ?? 'Suscripción {planName}',
      maxRetries: maxRetries ?? 5,
    };
  }

  private parseYYYYMMDD(s: string | undefined | null): Date | null {
    if (!s || !/^\d{8}$/.test(s)) return null;
    return new Date(
      `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00Z`,
    );
  }
}
