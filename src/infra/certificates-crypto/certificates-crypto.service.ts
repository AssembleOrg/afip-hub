import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

interface CertificateMaterial {
  certificate: string;
  privateKey: string;
  cuit: string;
}

interface EncryptContext {
  organizationId: string;
  certificateId: string;
}

interface EncryptedCertificateMaterial {
  encryptedPayload: string;
  encryptionIv: string;
  encryptionTag: string;
  encryptionKeyVersion: number;
}

@Injectable()
export class CertificatesCryptoService {
  private readonly logger = new Logger(CertificatesCryptoService.name);
  private readonly key: Buffer | null;
  private readonly keyVersion: number;

  constructor(private readonly config: ConfigService) {
    this.key = this.parseMasterKey(
      this.config.get<string>('certificates.masterKey') ?? '',
    );
    this.keyVersion =
      this.config.get<number>('certificates.keyVersion') ?? 1;

    if (!this.key) {
      this.logger.warn(
        'CERT_MASTER_KEY no configurada o inválida. La carga y lectura de certificados persistidos quedará deshabilitada.',
      );
    }
  }

  isAvailable(): boolean {
    return this.key !== null;
  }

  encrypt(
    material: CertificateMaterial,
    context: EncryptContext,
  ): EncryptedCertificateMaterial {
    const key = this.requireKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(this.buildAad(context));

    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(material), 'utf8'),
      cipher.final(),
    ]);

    return {
      encryptedPayload: ciphertext.toString('base64'),
      encryptionIv: iv.toString('base64'),
      encryptionTag: cipher.getAuthTag().toString('base64'),
      encryptionKeyVersion: this.keyVersion,
    };
  }

  decrypt(
    payload: EncryptedCertificateMaterial,
    context: EncryptContext,
  ): CertificateMaterial {
    const key = this.requireKey();

    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        Buffer.from(payload.encryptionIv, 'base64'),
      );
      decipher.setAAD(this.buildAad(context));
      decipher.setAuthTag(Buffer.from(payload.encryptionTag, 'base64'));

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(payload.encryptedPayload, 'base64')),
        decipher.final(),
      ]).toString('utf8');

      const material = JSON.parse(plaintext) as CertificateMaterial;
      if (!material?.certificate || !material?.privateKey || !material?.cuit) {
        throw new Error('payload incompleto');
      }

      return material;
    } catch (err) {
      this.logger.error(
        `No se pudo desencriptar el certificado ${context.certificateId}: ${String(err)}`,
      );
      throw new InternalServerErrorException(
        'No se pudo desencriptar el certificado persistido.',
      );
    }
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ServiceUnavailableException(
        'CERT_MASTER_KEY no configurada. Seteá una clave AES-256 para usar certificados persistidos.',
      );
    }
    return this.key;
  }

  private buildAad(context: EncryptContext): Buffer {
    return Buffer.from(
      `org:${context.organizationId};cert:${context.certificateId}`,
      'utf8',
    );
  }

  private parseMasterKey(raw: string): Buffer | null {
    if (!raw) return null;

    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }

    try {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) return decoded;
    } catch {
      // seguimos
    }

    if (Buffer.byteLength(raw, 'utf8') === 32) {
      return Buffer.from(raw, 'utf8');
    }

    return null;
  }
}
