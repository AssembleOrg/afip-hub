import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BILLABLE_KEY, BillableMetadata } from '../decorators/billable.decorator';
import { EmisoresService } from '@/modules/emisores/emisores.service';
import { SaasRequest } from '../types/request-context';
import { UsageKind } from '../../../generated/prisma';

/**
 * Después de SaasAuthGuard y QuotaGuard. Si el endpoint es billable y el body
 * trae un CUIT emisor (o representada), exige que esté registrado como Emisor
 * activo y validado contra AFIP.
 *
 * Esto previene que alguien use permisos ARCA de 200 emisores con un plan
 * Starter (15 slots): para facturar desde un CUIT, primero hay que registrarlo
 * como Emisor (lo que consume un slot de plan.cuitLimit).
 */
@Injectable()
export class CuitLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly emisores: EmisoresService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const billable = this.reflector.getAllAndOverride<BillableMetadata>(
      BILLABLE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    // No aplicamos cuit-limit a endpoints no billables ni a TA.
    if (
      !billable ||
      billable.kind === UsageKind.NON_BILLABLE ||
      billable.kind === UsageKind.TA
    ) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const org = req.organization;
    if (!org) return true;

    const cuit = this.extractCuit(req.body);
    if (!cuit) return true;

    const emisor = await this.emisores.findOrAutoRegister(
      org.id,
      cuit,
      org.cuitLimit,
      org.planSlug,
    );
    if (!emisor) return true;

    void this.emisores.touchUsage(emisor.id);
    return true;
  }

  private extractCuit(body: unknown): string | null {
    if (!body || typeof body !== 'object') return null;
    const b = body as Record<string, unknown>;
    // Convención: en /afip/* los emisores vienen como cuitEmisor;
    // en /afip/ve/* y consultas Padrón A13 como cuitRepresentada.
    const isStringOrNumber = (v: unknown): v is string | number =>
      typeof v === 'string' || typeof v === 'number';
    if (isStringOrNumber(b.cuitEmisor)) return String(b.cuitEmisor);
    if (isStringOrNumber(b.cuitRepresentada)) return String(b.cuitRepresentada);
    return null;
  }
}
