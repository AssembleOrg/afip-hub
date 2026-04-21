import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as nodemailer from 'nodemailer';
import { EmailTemplateRenderer, TemplatePayload } from './template-renderer';

export interface SendTemplateParams<TData = Record<string, unknown>> {
  to: string;
  toName?: string;
  template: string;
  subject: string;
  preheader: string;
  data?: TData;
}

export interface SendRawParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Email transaccional. Provider-pluggable:
 *  - `brevo` (default en prod): API transaccional v3 vía HTTP. Rápida, con
 *    logs, trackeo de delivery/bounce y rate-limit generoso (300/día free).
 *  - `smtp`: fallback para quien no quiere Brevo — nodemailer contra cualquier SMTP.
 *  - `console`: dev mode — solo loguea en stdout, no envía.
 *
 * Si EMAIL_PROVIDER=brevo pero `BREVO_API_KEY` no está seteada, cae a `console`
 * con warning. Así dev-local no se rompe sin config.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private provider: 'brevo' | 'smtp' | 'console' = 'console';
  private brevoClient: AxiosInstance | null = null;
  private smtpClient: nodemailer.Transporter | null = null;
  private fromEmail!: string;
  private fromName!: string;
  private replyTo = '';

  constructor(
    private readonly config: ConfigService,
    private readonly renderer: EmailTemplateRenderer,
  ) {}

  onModuleInit() {
    this.fromEmail = this.config.get<string>('email.fromEmail')!;
    this.fromName = this.config.get<string>('email.fromName')!;
    this.replyTo = this.config.get<string>('email.replyTo') || '';

    const requestedRaw = this.config.get<string>('email.provider') || 'brevo';
    const requested = requestedRaw
      .trim()
      .toLowerCase()
      .replace(/^"+|"+$/g, '') as 'brevo' | 'smtp' | 'console';

    if (requested === 'brevo') {
      const apiKey = (this.config.get<string>('email.brevoApiKey') || '').trim();
      if (!apiKey) {
        this.logger.warn(
          'BREVO_API_KEY no seteada — EmailService cae a modo consola (dev).',
        );
        this.provider = 'console';
        return;
      }
      this.provider = 'brevo';
      this.brevoClient = axios.create({
        baseURL: 'https://api.brevo.com/v3',
        timeout: 10000,
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
      });
      this.logger.log('Email provider: Brevo (transactional API v3)');
      return;
    }

    if (requested === 'smtp') {
      const host = this.config.get<string>('email.host');
      if (!host) {
        this.logger.warn('SMTP_HOST no seteado — EmailService cae a consola.');
        this.provider = 'console';
        return;
      }
      this.smtpClient = nodemailer.createTransport({
        host,
        port: this.config.get<number>('email.port') ?? 587,
        secure: this.config.get<boolean>('email.secure') ?? false,
        auth: {
          user: this.config.get<string>('email.user')!,
          pass: this.config.get<string>('email.password')!,
        },
      });
      this.provider = 'smtp';
      this.logger.log(
        `Email provider: SMTP (${host})`,
      );
      return;
    }

    this.provider = 'console';
    this.logger.warn(
      `EMAIL_PROVIDER inválido ("${requestedRaw}"). Valores permitidos: brevo | smtp | console. Se usa modo consola.`,
    );
  }

  /**
   * Envía email renderizando un template Handlebars. Método principal —
   * usalo siempre que se pueda. El layout agrega branding, footer y fallback
   * plaintext automáticamente.
   */
  async sendTemplate<T extends Record<string, unknown>>(
    params: SendTemplateParams<T>,
  ): Promise<void> {
    const payload: TemplatePayload = {
      subject: params.subject,
      preheader: params.preheader,
      ...(params.data ?? {}),
    };
    const rendered = this.renderer.render(params.template, payload);

    await this.sendRaw({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /** Escape hatch para HTML crudo. Preferí `sendTemplate`. */
  async sendRaw(params: SendRawParams): Promise<void> {
    switch (this.provider) {
      case 'brevo':
        await this.sendViaBrevo(params);
        return;
      case 'smtp':
        await this.sendViaSmtp(params);
        return;
      case 'console':
      default:
        this.logger.log(
          `📧 [DEV] To: ${params.to} | Subject: ${params.subject}\n${params.text ?? '(html omitido — setear EMAIL_PROVIDER=smtp o brevo para ver)'}`,
        );
    }
  }

  private async sendViaBrevo(params: SendRawParams): Promise<void> {
    if (!this.brevoClient) return;
    try {
      const { data } = await this.brevoClient.post('/smtp/email', {
        sender: { email: this.fromEmail, name: this.fromName },
        to: [{ email: params.to }],
        replyTo: this.replyTo ? { email: this.replyTo } : undefined,
        subject: params.subject,
        htmlContent: params.html,
        textContent: params.text,
        tags: ['afip-hub', 'transactional'],
      });
      this.logger.log(
        `Email enviado via Brevo a ${params.to} (messageId=${data?.messageId ?? 'n/a'})`,
      );
    } catch (err: any) {
      const status = err.response?.status;
      const body = err.response?.data;
      this.logger.error(
        `Brevo rechazó email a ${params.to}: status=${status} ${JSON.stringify(body ?? err.message)}`,
      );
      throw err;
    }
  }

  private async sendViaSmtp(params: SendRawParams): Promise<void> {
    if (!this.smtpClient) return;
    try {
      const info = await this.smtpClient.sendMail({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: params.to,
        replyTo: this.replyTo || undefined,
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
      this.logger.log(`Email SMTP a ${params.to} (id=${info.messageId})`);
    } catch (err) {
      this.logger.error(`SMTP falló a ${params.to}: ${String(err)}`);
      throw err;
    }
  }
}
