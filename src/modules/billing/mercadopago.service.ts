import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'node:crypto';

const MP_BASE_URL = 'https://api.mercadopago.com';

export interface MpPreapprovalData {
  id: string;
  status: string; // pending | authorized | paused | cancelled | finished
  init_point: string;
  preapproval_plan_id?: string;
  payer_email?: string;
  payer_id?: number;
  auto_recurring: {
    frequency: number;
    frequency_type: string;
    transaction_amount: number;
    currency_id: string;
    start_date?: string;
    end_date?: string;
  };
  next_payment_date?: string;
  external_reference?: string;
}

export interface MpPaymentData {
  id: number;
  status: string; // approved | pending | in_process | rejected | refunded
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  date_approved?: string;
  date_created: string;
  preapproval_id?: string;
  payer?: { id?: number; email?: string };
  external_reference?: string;
}

export interface MpPreferenceData {
  id: string;
  init_point: string;
  sandbox_init_point: string;
  external_reference?: string;
  items: Array<{ title: string; quantity: number; unit_price: number; currency_id: string }>;
}

/**
 * Cliente de MercadoPago para suscripciones (preapproval). Lo mantenemos thin:
 * solo crea/actualiza/cancela preapprovals y resuelve payments. La lógica de
 * negocio vive en `SubscriptionService` / `BillingService`.
 *
 * Usamos el flujo "monto fijo" → antes de cada ciclo ajustamos `transaction_amount`
 * según el dólar blue del día. Saltos >20% pueden requerir re-consentimiento
 * del usuario (MP lo marca con status=paused y nos lo notifica por webhook).
 */
@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: MP_BASE_URL,
      timeout: 15000,
    });
  }

  isConfigured(): boolean {
    return !!this.config.get<string>('mercadopago.accessToken');
  }

  async createPreapproval(params: {
    payerEmail: string;
    reason: string;
    amountArs: number;
    externalReference: string;
    backUrl?: string;
    /** Si se pasa, MP no cobra hasta esta fecha (útil para alinear ciclos). */
    startDate?: Date;
  }): Promise<MpPreapprovalData> {
    const token = this.requireToken();
    const frequency = this.config.get<number>('mercadopago.frequency') ?? 1;
    const frequencyType =
      this.config.get<string>('mercadopago.frequencyType') ?? 'months';

    const body = {
      payer_email: params.payerEmail,
      reason: params.reason,
      external_reference: params.externalReference,
      auto_recurring: {
        frequency,
        frequency_type: frequencyType,
        transaction_amount: this.round2(params.amountArs),
        currency_id: 'ARS',
        ...(params.startDate && { start_date: params.startDate.toISOString() }),
      },
      back_url:
        params.backUrl ||
        this.config.get<string>('mercadopago.backSuccessUrl') ||
        undefined,
      status: 'pending',
    };

    try {
      const { data } = await this.http.post<MpPreapprovalData>(
        '/preapproval',
        body,
        this.headers(token),
      );
      this.logger.log(
        `Preapproval creado id=${data.id} status=${data.status} monto=${body.auto_recurring.transaction_amount}`,
      );
      return data;
    } catch (err: any) {
      this.logger.error(
        `Error creando preapproval: ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw new InternalServerErrorException(
        `MercadoPago rechazó la creación del preapproval: ${err.response?.data?.message ?? err.message}`,
      );
    }
  }

  async updateAmount(preapprovalId: string, newAmountArs: number) {
    const token = this.requireToken();
    try {
      const { data } = await this.http.put<MpPreapprovalData>(
        `/preapproval/${preapprovalId}`,
        {
          auto_recurring: { transaction_amount: this.round2(newAmountArs) },
        },
        this.headers(token),
      );
      this.logger.log(
        `Preapproval ${preapprovalId} actualizado a $${newAmountArs} ARS (status=${data.status})`,
      );
      return data;
    } catch (err: any) {
      this.logger.error(
        `Error actualizando preapproval ${preapprovalId}: ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw new InternalServerErrorException(
        `MP rechazó la actualización del monto: ${err.response?.data?.message ?? err.message}`,
      );
    }
  }

  async cancel(preapprovalId: string) {
    const token = this.requireToken();
    const { data } = await this.http.put<MpPreapprovalData>(
      `/preapproval/${preapprovalId}`,
      { status: 'cancelled' },
      this.headers(token),
    );
    this.logger.log(`Preapproval ${preapprovalId} cancelado`);
    return data;
  }

  /**
   * Crea un Checkout one-time (Preference) para cobrar un monto único.
   * Usado para prorrateos de addons al medio de un ciclo.
   */
  async createPreference(params: {
    title: string;
    amountArs: number;
    externalReference: string;
    payerEmail?: string;
    backUrl?: string;
  }): Promise<MpPreferenceData> {
    const token = this.requireToken();
    const backBase =
      params.backUrl ||
      this.config.get<string>('mercadopago.backSuccessUrl') ||
      undefined;

    const body = {
      items: [
        {
          title: params.title,
          quantity: 1,
          unit_price: this.round2(params.amountArs),
          currency_id: 'ARS',
        },
      ],
      payer: params.payerEmail ? { email: params.payerEmail } : undefined,
      external_reference: params.externalReference,
      back_urls: backBase
        ? { success: backBase, failure: backBase, pending: backBase }
        : undefined,
      auto_return: backBase ? 'approved' : undefined,
    };

    try {
      const { data } = await this.http.post<MpPreferenceData>(
        '/checkout/preferences',
        body,
        this.headers(token),
      );
      this.logger.log(
        `Preference creado id=${data.id} monto=${body.items[0].unit_price} ref=${params.externalReference}`,
      );
      return data;
    } catch (err: any) {
      this.logger.error(
        `Error creando preference: ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw new InternalServerErrorException(
        `MP rechazó la creación del checkout: ${err.response?.data?.message ?? err.message}`,
      );
    }
  }

  async getPreapproval(preapprovalId: string): Promise<MpPreapprovalData> {
    const token = this.requireToken();
    const { data } = await this.http.get<MpPreapprovalData>(
      `/preapproval/${preapprovalId}`,
      this.headers(token),
    );
    return data;
  }

  async getPayment(paymentId: string | number): Promise<MpPaymentData> {
    const token = this.requireToken();
    const { data } = await this.http.get<MpPaymentData>(
      `/v1/payments/${paymentId}`,
      this.headers(token),
    );
    return data;
  }

  /**
   * Verifica firma del webhook. MP firma cada notificación con el esquema:
   *   ts=<timestamp>,v1=<hmac_sha256>
   * donde el template es `id:<resource_id>;request-id:<x-request-id>;ts:<ts>;`
   *
   * Sin secreto configurado, aceptamos (útil en dev), pero logueamos warning.
   */
  verifyWebhookSignature(params: {
    resourceId: string;
    requestId?: string;
    xSignature?: string;
  }): boolean {
    const secret = this.config.get<string>('mercadopago.webhookSecret');
    if (!secret) {
      this.logger.warn(
        'MP_WEBHOOK_SECRET no configurado: aceptando webhook sin validar firma (NO usar en prod).',
      );
      return true;
    }
    if (!params.xSignature) return false;

    const parts = Object.fromEntries(
      params.xSignature
        .split(',')
        .map((p) => p.trim().split('=') as [string, string]),
    );
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;

    const template = `id:${params.resourceId};request-id:${params.requestId ?? ''};ts:${ts};`;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(template)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  private requireToken(): string {
    const token = this.config.get<string>('mercadopago.accessToken');
    if (!token) {
      throw new BadRequestException(
        'MercadoPago no configurado (MP_ACCESS_TOKEN vacío).',
      );
    }
    return token;
  }

  private headers(token: string) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
    };
  }

  private round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }
}
