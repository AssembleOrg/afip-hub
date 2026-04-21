import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { CertificatesCryptoService } from '@/infra/certificates-crypto';

export interface MasterCertMaterial {
  cuit: string;
  certificate: string;
  privateKey: string;
}

// Claves en admin_settings
const KEY_CUIT = 'master_padron.cuit';
const KEY_PAYLOAD = 'master_padron.encrypted_payload';
const KEY_IV = 'master_padron.encryption_iv';
const KEY_TAG = 'master_padron.encryption_tag';

// Contexto fijo para AAD del cifrado AES-GCM
const ENCRYPT_CTX = { organizationId: 'platform', certificateId: 'master-padron' };

@Injectable()
export class PlatformCertService {
  private readonly logger = new Logger(PlatformCertService.name);
  private cached: MasterCertMaterial | null = null;
  private cacheExpiresAt = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CertificatesCryptoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Devuelve el cert maestro.
   * Orden de resolución:
   *  1. Cache en memoria (TTL 5 min)
   *  2. admin_settings (cifrado con CERT_MASTER_KEY)
   *  3. Variables de entorno MASTER_PADRON_* (legacy, con aviso)
   */
  async getMaterial(): Promise<MasterCertMaterial | null> {
    if (this.cached && Date.now() < this.cacheExpiresAt) {
      return this.cached;
    }

    const material = await this.loadFromDb() ?? this.loadFromEnv();
    if (material) {
      this.cached = material;
      this.cacheExpiresAt = Date.now() + this.CACHE_TTL_MS;
    }
    return material;
  }

  /**
   * Guarda el cert maestro cifrado en admin_settings.
   * Invalida el cache en memoria.
   */
  async setMaterial(input: MasterCertMaterial): Promise<void> {
    if (!this.crypto.isAvailable()) {
      throw new BadRequestException(
        'CERT_MASTER_KEY no configurada. No se puede cifrar el certificado maestro.',
      );
    }

    const encrypted = this.crypto.encrypt(
      { certificate: input.certificate, privateKey: input.privateKey, cuit: input.cuit },
      ENCRYPT_CTX,
    );

    await this.prisma.$transaction([
      this.upsert(KEY_CUIT, input.cuit),
      this.upsert(KEY_PAYLOAD, encrypted.encryptedPayload),
      this.upsert(KEY_IV, encrypted.encryptionIv),
      this.upsert(KEY_TAG, encrypted.encryptionTag),
    ]);

    this.cached = input;
    this.cacheExpiresAt = Date.now() + this.CACHE_TTL_MS;
    this.logger.log('Certificado maestro actualizado en admin_settings.');
  }

  /** Invalida el cache para forzar recarga en el próximo uso. */
  invalidateCache(): void {
    this.cached = null;
    this.cacheExpiresAt = 0;
  }

  private async loadFromDb(): Promise<MasterCertMaterial | null> {
    try {
      const rows = await this.prisma.adminSetting.findMany({
        where: { key: { in: [KEY_CUIT, KEY_PAYLOAD, KEY_IV, KEY_TAG] } },
        select: { key: true, value: true },
      });

      const map = new Map(rows.map((r) => [r.key, r.value as string]));
      const payload = map.get(KEY_PAYLOAD);
      const iv = map.get(KEY_IV);
      const tag = map.get(KEY_TAG);
      const cuit = map.get(KEY_CUIT);

      if (!payload || !iv || !tag || !cuit) return null;

      const material = this.crypto.decrypt({ encryptedPayload: payload, encryptionIv: iv, encryptionTag: tag, encryptionKeyVersion: 1 }, ENCRYPT_CTX);
      return { cuit: String(cuit), certificate: material.certificate, privateKey: material.privateKey };
    } catch (err) {
      this.logger.error(`No se pudo cargar el cert maestro desde admin_settings: ${String(err)}`);
      return null;
    }
  }

  private loadFromEnv(): MasterCertMaterial | null {
    const cuit = this.config.get<string>('masterPadron.cuit') ?? '';
    const certificate = this.config.get<string>('masterPadron.certificate') ?? '';
    const privateKey = this.config.get<string>('masterPadron.privateKey') ?? '';

    if (!cuit || !certificate || !privateKey) return null;

    this.logger.warn(
      'Usando MASTER_PADRON_CERT/KEY desde variables de entorno. Migrá al admin settings para mayor seguridad.',
    );
    return { cuit, certificate: this.decodePem(certificate), privateKey: this.decodePem(privateKey) };
  }

  private upsert(key: string, value: string) {
    return this.prisma.adminSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  private decodePem(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('-----')) return trimmed;
    try {
      return Buffer.from(trimmed, 'base64').toString('utf-8');
    } catch {
      return trimmed;
    }
  }
}
