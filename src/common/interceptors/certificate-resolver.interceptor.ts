import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, switchMap } from 'rxjs';
import { CertificatesService } from '@/modules/certificates/certificates.service';
import { EmisoresService } from '@/modules/emisores/emisores.service';
import { PlatformCertService } from '@/modules/platform-cert/platform-cert.service';
import { EmisorCertMode } from '../../../generated/prisma';
import { SaasRequest } from '../types/request-context';

/**
 * Resuelve el certificado AFIP a usar antes de pasar el request a los handlers.
 *
 * Prioridad:
 *  1. `certificateId` en body → resuelve cert cifrado desde DB (cuenta del tenant).
 *  2. `certificado` + `clavePrivada` en body → pasan directo (inline stateless).
 *  3. Solo `cuitEmisor` (sin cert) + org resuelta → busca el emisor; si es
 *     PLATFORM inyecta el cert maestro del SaaS; si es ACCOUNT sin cert inline
 *     no puede hacer nada (el handler dará 400 por campos vacíos).
 */
@Injectable()
export class CertificateResolverInterceptor implements NestInterceptor {
  constructor(
    private readonly certs: CertificatesService,
    private readonly emisores: EmisoresService,
    private readonly platformCert: PlatformCertService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<SaasRequest>();
    const body = (req.body as Record<string, unknown> | undefined) ?? {};

    const certId = typeof body.certificateId === 'string' ? body.certificateId : null;
    const hasCertInline =
      typeof body.certificado === 'string' && (body.certificado as string).length > 0;

    // Caso 1: certificateId provisto → resuelve y sobreescribe.
    if (certId && req.organization) {
      return from(this.certs.resolveMaterial(req.organization.id, certId)).pipe(
        switchMap((material) => {
          this.hydrateCert(body, material.certificate, material.privateKey, material.cuit);
          return next.handle();
        }),
      );
    }

    // Caso 2: cert inline ya presente → pasa sin tocar.
    if (hasCertInline) {
      return next.handle();
    }

    // Caso 3: solo cuitEmisor, sin cert → intentamos resolver via emisor registrado.
    const cuitEmisor =
      typeof body.cuitEmisor === 'string' ? (body.cuitEmisor as string).replace(/\D/g, '') : null;

    if (!cuitEmisor || !req.organization) {
      return next.handle();
    }

    return from(this.emisores.findActiveByCuit(req.organization.id, cuitEmisor)).pipe(
      switchMap((emisor) => {
        if (!emisor) return next.handle();

        if (emisor.certMode === EmisorCertMode.PLATFORM) {
          // Modo plataforma: inyectamos el cert maestro del SaaS.
          return from(this.platformCert.getMaterial()).pipe(
            switchMap((master) => {
              if (master) {
                this.hydrateCert(body, master.certificate, master.privateKey, cuitEmisor);
              }
              return next.handle();
            }),
          );
        }

        if (emisor.certMode === EmisorCertMode.ACCOUNT && emisor.certificateId) {
          // Modo cuenta: resolvemos el cert vinculado.
          return from(
            this.certs.resolveMaterial(req.organization!.id, emisor.certificateId),
          ).pipe(
            switchMap((material) => {
              this.hydrateCert(body, material.certificate, material.privateKey, material.cuit);
              return next.handle();
            }),
          );
        }

        return next.handle();
      }),
    );
  }

  private hydrateCert(
    body: Record<string, unknown>,
    certificate: string,
    privateKey: string,
    cuit?: string,
  ) {
    body.certificado = certificate;
    body.clavePrivada = privateKey;
    const hasEmisor =
      typeof body.cuitEmisor === 'string' && (body.cuitEmisor as string).length > 0;
    const hasRepresentada =
      typeof body.cuitRepresentada === 'string' &&
      (body.cuitRepresentada as string).length > 0;
    if (!hasEmisor && !hasRepresentada && cuit) {
      body.cuitEmisor = cuit;
    }
  }

}
