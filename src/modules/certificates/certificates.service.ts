import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as forge from 'node-forge';
import { PrismaService } from '@/database/prisma.service';
import { CertificatesCryptoService } from '@/infra/certificates-crypto';
import { AuditService } from '@/modules/audit/audit.service';
import { AuditActor, Prisma } from '../../../generated/prisma';
import { CreateCertificateDto, mapCertToResponse } from './dto';

interface ParsedCertInfo {
  cuit: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
}

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CertificatesCryptoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Guarda cert+key cifrados en DB y persiste metadata en claro. Valida:
   *  - El certificado parsea como PEM X.509
   *  - Tiene un serialNumber en el subject (el CUIT)
   *  - Cert sigue vigente al momento de subirse
   *  - No duplicado (mismo fingerprint) para la org
   *
   * El plaintext del cert **nunca** se persiste en DB.
   */
  async create(params: {
    organizationId: string;
    createdByUserId: string;
    dto: CreateCertificateDto;
  }) {
    if (!this.cryptoService.isAvailable()) {
      throw new BadRequestException(
        'CERT_MASTER_KEY no configurada. Sin clave maestra no se pueden guardar certificados.',
      );
    }

    const info = this.parseCertificate(params.dto.certificate);
    if (info.notAfter.getTime() < Date.now()) {
      throw new BadRequestException(
        `Este certificado vence el ${info.notAfter.toISOString()} (ya vencido).`,
      );
    }

    // Chequeo de duplicado ANTES de persistir material sensible.
    const existing = await this.prisma.certificate.findUnique({
      where: {
        organizationId_fingerprint: {
          organizationId: params.organizationId,
          fingerprint: info.fingerprint,
        },
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya tenés este mismo certificado guardado como "${existing.alias}" (fingerprint idéntico).`,
      );
    }

    const certificateId = crypto.randomUUID();
    const encrypted = this.cryptoService.encrypt(
      {
        certificate: params.dto.certificate,
        privateKey: params.dto.privateKey,
        cuit: info.cuit,
      },
      {
        organizationId: params.organizationId,
        certificateId,
      },
    );

    const createData: Prisma.CertificateUncheckedCreateInput = {
      id: certificateId,
      organizationId: params.organizationId,
      alias: params.dto.alias,
      cuit: info.cuit,
      fingerprint: info.fingerprint,
      vaultPath: 'db-encrypted',
      encryptedPayload: encrypted.encryptedPayload,
      encryptionIv: encrypted.encryptionIv,
      encryptionTag: encrypted.encryptionTag,
      encryptionKeyVersion: encrypted.encryptionKeyVersion,
      notBefore: info.notBefore,
      notAfter: info.notAfter,
      createdByUserId: params.createdByUserId,
    };

    const record = await this.prisma.certificate.create({
      data: createData,
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: params.createdByUserId,
      organizationId: params.organizationId,
      action: 'certificate.created',
      severity: 'warn',
      targetType: 'certificate',
      targetId: certificateId,
      metadata: {
        alias: record.alias,
        cuit: info.cuit,
        notAfter: info.notAfter,
      },
    });

    return mapCertToResponse(record);
  }

  async list(organizationId: string) {
    const rows = await this.prisma.certificate.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((r) => mapCertToResponse(r)) };
  }

  async get(organizationId: string, id: string) {
    const row = await this.prisma.certificate.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('Certificado no encontrado');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El certificado pertenece a otra organización');
    }
    return mapCertToResponse(row);
  }

  async remove(organizationId: string, id: string, actorUserId?: string) {
    const row = await this.prisma.certificate.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException('Certificado no encontrado');
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El certificado pertenece a otra organización');
    }

    // Verificamos si alguna ScheduledTask sigue usándolo.
    const inUse = await this.prisma.scheduledTask.count({
      where: { certificateId: id, deletedAt: null, isActive: true },
    });
    if (inUse > 0) {
      throw new BadRequestException(
        `No se puede eliminar: ${inUse} tarea(s) programada(s) activa(s) lo usan. Desactiválas primero.`,
      );
    }

    await this.prisma.certificate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    void this.audit.record({
      actorType: AuditActor.USER,
      actorUserId: actorUserId ?? null,
      organizationId,
      action: 'certificate.deleted',
      severity: 'warn',
      targetType: 'certificate',
      targetId: id,
      metadata: { alias: row.alias, cuit: row.cuit },
    });
  }

  /**
   * Usado por ScheduledTasks y flows internos: lee el cert cifrado desde DB.
   * Lanza si no existe o está vencido.
   */
  async resolveMaterial(
    organizationId: string,
    certId: string,
  ): Promise<{ certificate: string; privateKey: string; cuit: string }> {
    const row = await this.prisma.certificate.findUnique({
      where: { id: certId },
      select: {
        id: true,
        organizationId: true,
        alias: true,
        cuit: true,
        fingerprint: true,
        vaultPath: true,
        encryptedPayload: true,
        encryptionIv: true,
        encryptionTag: true,
        encryptionKeyVersion: true,
        notBefore: true,
        notAfter: true,
        isActive: true,
        lastUsedAt: true,
        lastUsedByTaskId: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException(`Certificate ${certId} no existe`);
    }
    if (row.organizationId !== organizationId) {
      throw new ForbiddenException('El certificado es de otra organización');
    }
    if (!row.isActive) throw new BadRequestException('Certificado inactivo');
    if (row.notAfter.getTime() < Date.now()) {
      throw new BadRequestException('Certificado vencido');
    }

    if (!row.encryptedPayload || !row.encryptionIv || !row.encryptionTag) {
      throw new BadRequestException(
        'Este certificado pertenece al esquema anterior basado en Vault y no tiene material cifrado en la base. Volvé a subirlo para usarlo.',
      );
    }

    const material = this.cryptoService.decrypt(
      {
        encryptedPayload: row.encryptedPayload,
        encryptionIv: row.encryptionIv,
        encryptionTag: row.encryptionTag,
        encryptionKeyVersion: row.encryptionKeyVersion,
      },
      {
        organizationId,
        certificateId: certId,
      },
    );

    // Actualizamos lastUsedAt (best-effort).
    this.prisma.certificate
      .update({ where: { id: certId }, data: { lastUsedAt: new Date() } })
      .catch((e) => {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2025'
        ) {
          this.logger.warn(`No pude actualizar lastUsedAt: ${String(e)}`);
        }
      });

    return {
      certificate: material.certificate,
      privateKey: material.privateKey,
      cuit: material.cuit,
    };
  }

  /**
   * Parsea un cert PEM con node-forge y extrae CUIT del serialNumber del
   * subject. En AFIP el CUIT viene como `serialNumber=CUIT 20-...-9`.
   */
  private parseCertificate(pem: string): ParsedCertInfo {
    let cert: forge.pki.Certificate;
    try {
      cert = forge.pki.certificateFromPem(pem);
    } catch {
      throw new BadRequestException(
        'El certificado no es un PEM X.509 válido. Subilo con headers BEGIN/END CERTIFICATE.',
      );
    }

    // CUIT del subject
    const serialAttr = cert.subject.getField('serialNumber');
    const rawSerial = typeof serialAttr?.value === 'string' ? serialAttr.value : '';
    const cuitMatch = rawSerial.match(/(\d{11})/) || rawSerial.match(/CUIT\s*(\d[\d-]*\d)/i);
    const cuit = (cuitMatch?.[1] ?? '').replace(/[^\d]/g, '');
    if (!/^\d{11}$/.test(cuit)) {
      throw new BadRequestException(
        'No pude extraer el CUIT del certificado (subject.serialNumber). Verificá que sea un cert de AFIP.',
      );
    }

    // Fingerprint sha256 del DER
    const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const fingerprint = crypto
      .createHash('sha256')
      .update(Buffer.from(derBytes, 'binary'))
      .digest('hex');

    return {
      cuit,
      fingerprint,
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
    };
  }

}
