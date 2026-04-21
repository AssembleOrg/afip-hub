import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '@/database/prisma.service';
import { SelfBillingService } from './self-billing.service';
import { EVENTS } from '@/common/events';
import type { PaymentApprovedPayload } from '@/common/events';

/**
 * Al llegar `PAYMENT_APPROVED`, buscamos el Payment local (por mpPaymentId)
 * y delegamos a SelfBillingService.issueForPayment. El service maneja todo:
 * dedupe, early-exits si no está configurado, retry tracking, errores.
 *
 * No bloqueamos el flujo si falla — queda PlatformInvoice.FAILED para retry.
 */
@Injectable()
export class SelfBillingListener {
  private readonly logger = new Logger(SelfBillingListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly selfBilling: SelfBillingService,
  ) {}

  @OnEvent(EVENTS.PAYMENT_APPROVED, { async: true })
  async handle(p: PaymentApprovedPayload) {
    // El payload tiene mpPaymentId como string. Buscamos el Payment local.
    const payment = await this.prisma.payment.findUnique({
      where: { mpPaymentId: p.paymentId },
    });
    if (!payment) {
      this.logger.warn(
        `PAYMENT_APPROVED recibido pero no hay Payment local con mpPaymentId=${p.paymentId}`,
      );
      return;
    }

    try {
      await this.selfBilling.issueForPayment(payment.id);
    } catch (err) {
      this.logger.error(
        `issueForPayment ${payment.id} falló inesperadamente: ${String(err)}`,
      );
    }
  }
}
