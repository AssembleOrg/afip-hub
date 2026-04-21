import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';

// En dev (ts-node) __dirname = src/modules/email, templates al lado.
// En prod webpack bundlea todo a dist/main.js y copia los .hbs a
// dist/src/modules/email/templates/. Probamos todos los candidatos.
const TEMPLATE_CANDIDATES = [
  path.join(__dirname, 'templates'),
  path.join(process.cwd(), 'dist/src/modules/email/templates'),
  path.join(process.cwd(), 'src/modules/email/templates'),
];

function resolveTemplatesDir(): string {
  for (const c of TEMPLATE_CANDIDATES) {
    if (fs.existsSync(path.join(c, '_layout.hbs'))) return c;
  }
  return TEMPLATE_CANDIDATES[0];
}

const TEMPLATES_DIR = resolveTemplatesDir();

export interface TemplatePayload {
  subject: string;
  preheader: string;
  headerTag?: string;
  [key: string]: unknown;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Render de templates Handlebars. Carga el layout + el template específico
 * una sola vez al arrancar (caching). Compatible con dark mode via meta tags.
 *
 * Los templates viven en `src/modules/email/templates/*.hbs`.
 * Nest build copia `.hbs` al dist vía asset rule (webpack.config.js).
 */
@Injectable()
export class EmailTemplateRenderer implements OnModuleInit {
  private readonly logger = new Logger(EmailTemplateRenderer.name);
  private layout!: Handlebars.TemplateDelegate;
  private templates = new Map<string, Handlebars.TemplateDelegate>();
  private brandDefaults: Record<string, unknown> = {};

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const layoutPath = path.join(TEMPLATES_DIR, '_layout.hbs');
    if (!fs.existsSync(layoutPath)) {
      this.logger.warn(`Layout no existe en ${layoutPath}`);
      return;
    }
    this.layout = Handlebars.compile(fs.readFileSync(layoutPath, 'utf8'));

    const primary = this.config.get<string>('branding.primaryColor') || '#2563EB';
    this.brandDefaults = {
      productName: this.config.get<string>('branding.productName'),
      primaryColor: primary,
      primaryColorDark: this.darken(primary, 0.15),
      logoUrl: this.config.get<string>('branding.logoUrl') || '',
      supportEmail: this.config.get<string>('branding.supportEmail'),
      dashboardUrl: this.config.get<string>('branding.dashboardUrl'),
      year: new Date().getFullYear(),
    };
  }

  render(templateName: string, payload: TemplatePayload): RenderedEmail {
    const tpl = this.getTemplate(templateName);
    const ctx = { ...this.brandDefaults, ...payload };
    const body = tpl(ctx);
    const html = this.layout({
      ...ctx,
      body,
      headerTag: payload.headerTag ?? this.defaultHeaderTag(templateName),
    });
    return {
      subject: payload.subject,
      html,
      text: this.htmlToText(body, payload),
    };
  }

  private getTemplate(name: string): Handlebars.TemplateDelegate {
    const cached = this.templates.get(name);
    if (cached) return cached;

    const filePath = path.join(TEMPLATES_DIR, `${name}.hbs`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template no encontrado: ${name} (${filePath})`);
    }
    const tpl = Handlebars.compile(fs.readFileSync(filePath, 'utf8'));
    this.templates.set(name, tpl);
    return tpl;
  }

  private defaultHeaderTag(name: string): string {
    const map: Record<string, string> = {
      'verify-email': 'CUENTA',
      'password-reset': 'SEGURIDAD',
      'quota-warning': 'USO',
      'quota-exhausted': 'LÍMITE',
      'payment-failed': 'FACTURACIÓN',
      'subscription-activated': 'PLAN',
      'subscription-canceled': 'PLAN',
      'blue-jumped': 'FACTURACIÓN',
    };
    return map[name] ?? 'NOTIFICACIÓN';
  }

  /** Plaintext muy simple: strip tags + preserve newlines + links visibles. */
  private htmlToText(html: string, payload: TemplatePayload): string {
    const withLinks = html.replace(
      /<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi,
      '$2 ($1)',
    );
    const stripped = withLinks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    return `${payload.preheader}\n\n${stripped}\n\n— ${this.brandDefaults.productName}`;
  }

  private darken(hex: string, amount: number): string {
    const parsed = hex.replace('#', '');
    if (parsed.length !== 6) return hex;
    const num = Number.parseInt(parsed, 16);
    const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amount)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amount)));
    const b = Math.max(0, Math.floor((num & 0xff) * (1 - amount)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
  }
}
