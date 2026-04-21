/**
 * Event types que emite el sistema. Se usan como nombres de evento en
 * `@nestjs/event-emitter` y como slugs en `WebhookSubscription.events`.
 *
 * Convención: `<dominio>.<acción>` en kebab/snake. Mantener estable — es
 * contrato público con los clientes que se suscriben a webhooks.
 */
export const EVENTS = {
  // Quota / usage
  QUOTA_WARNING_80: 'quota.warning_80',
  QUOTA_EXHAUSTED_100: 'quota.exhausted_100',

  // Billing (MercadoPago)
  PAYMENT_APPROVED: 'payment.approved',
  PAYMENT_FAILED: 'payment.failed',
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  SUBSCRIPTION_CANCELED: 'subscription.canceled',
  BLUE_JUMPED: 'billing.blue_jumped',

  // AFIP business
  INVOICE_EMITTED: 'invoice.emitted',

  // Scheduled tasks
  SCHEDULED_TASK_SUCCEEDED: 'scheduled_task.succeeded',
  SCHEDULED_TASK_FAILED: 'scheduled_task.failed',

  // Certificates
  CERTIFICATE_EXPIRING: 'certificate.expiring',

  // Ventanilla Electrónica AFIP
  VENTANILLA_NEW_MESSAGE: 'ventanilla.new_message',

  // Storage (alerta interna de plataforma, no se expone a webhooks de clientes)
  STORAGE_THRESHOLD_CROSSED: 'storage.threshold_crossed',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Eventos internos de plataforma que NO deben exponerse en la lista pública
 * de suscripciones de webhooks de clientes.
 */
const INTERNAL_ONLY_EVENTS = new Set<EventName>([
  EVENTS.STORAGE_THRESHOLD_CROSSED,
]);

/** Lista para UI de suscripción de webhooks (excluye eventos internos). */
export const ALL_EVENT_TYPES: EventName[] = Object.values(EVENTS).filter(
  (e) => !INTERNAL_ONLY_EVENTS.has(e),
);

// ============================================================
// Payloads tipados de cada evento
// ============================================================

export interface QuotaWarning80Payload {
  organizationId: string;
  ownerEmail: string;
  orgName: string;
  planSlug: string;
  used: number;
  limit: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface QuotaExhausted100Payload {
  organizationId: string;
  ownerEmail: string;
  orgName: string;
  planSlug: string;
  used: number;
  limit: number;
  graceLimit: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface PaymentApprovedPayload {
  organizationId: string;
  ownerEmail: string;
  paymentId: string;
  amountArs: number;
  amountUsd: number;
  exchangeRate: number;
  planSlug: string;
}

export interface PaymentFailedPayload {
  organizationId: string;
  ownerEmail: string;
  paymentId: string;
  amountArs: number;
  amountUsd: number;
  planSlug: string;
  reason: string;
  attemptedAt: Date;
}

export interface SubscriptionActivatedPayload {
  organizationId: string;
  ownerEmail: string;
  orgName: string;
  planSlug: string;
  planName: string;
  requestsLimit: number;
  cuitLimit: number;
  pdfRateLimit: number;
  amountArs: number;
  amountUsd: number;
  exchangeRate: number;
  nextBillingDate: Date;
}

export interface SubscriptionCanceledPayload {
  organizationId: string;
  ownerEmail: string;
  orgName: string;
  planSlug: string;
  planName: string;
  accessUntil: Date;
}

export interface BlueJumpedPayload {
  organizationId: string;
  ownerEmail: string;
  planSlug: string;
  planName: string;
  periodStart: Date;
  amountUsd: number;
  oldAmountArs: number;
  newAmountArs: number;
  exchangeRate: number;
  exchangeRateDate: Date;
  nextBillingDate: Date;
  needsReauth: boolean;
}

export interface InvoiceEmittedPayload {
  organizationId: string;
  invoiceId: string;
  cuitEmisor: string;
  puntoVenta: number;
  tipoComprobante: number;
  numeroComprobante: string; // BigInt serializado
  cae: string;
  importeTotal: number;
  fechaComprobante: string; // YYYY-MM-DD
  homologacion: boolean;
}

export interface ScheduledTaskResultPayload {
  organizationId: string;
  taskId: string;
  runId: string;
  type: string;
  status: 'OK' | 'FAILED';
  durationMs: number;
  error?: string;
}

export interface CertificateExpiringPayload {
  organizationId: string;
  certificateId: string;
  cuit: string;
  alias: string;
  notAfter: Date;
  daysUntilExpiry: number;
}

export interface VentanillaNewMessagePayload {
  organizationId: string;
  emisorId: string;
  emisorCuit: string;
  emisorAlias?: string | null;
  messageId: string;
  afipMessageId: string;  // stringified BigInt
  asunto: string;
  sistemaPublicadorDesc?: string | null;
  fechaPublicacion: Date;
  fechaVencimiento?: Date | null;
  ownerEmail: string;
  newCount: number; // cantidad total de mensajes nuevos en este batch
}

export interface StorageThresholdCrossedPayload {
  thresholdPct: number;       // 60, 80, 90
  usedBytes: number;
  volumeBytes: number;
  usedRatio: number;          // usedBytes / volumeBytes
  largestTables: { table: string; bytes: number }[]; // top 5
  checkedAt: Date;
}
