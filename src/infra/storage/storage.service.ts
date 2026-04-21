import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Cliente S3-compatible para DigitalOcean Spaces. La SDK de AWS habla el
 * protocolo S3 estándar; DO Spaces lo implementa 1:1 cambiando el endpoint.
 *
 * Key convention para invoices archivadas:
 *   {prefix}/orgs/{orgId}/invoices/{invoiceId}.json
 *
 * Si `SPACES_ENDPOINT` no está configurado, el servicio queda deshabilitado
 * y las operaciones lanzan 503. El retention cron no intenta archivar sin
 * storage; solo purga lo que puede purgarse sin mover a cold storage.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;
  private bucket!: string;
  private prefix!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const endpoint = this.config.get<string>('storage.endpoint');
    const bucket = this.config.get<string>('storage.bucket');
    const key = this.config.get<string>('storage.key');
    const secret = this.config.get<string>('storage.secret');

    if (!endpoint || !bucket || !key || !secret) {
      this.logger.warn(
        'SPACES_* incompleto → StorageService deshabilitado. Invoices no se archivarán a cold storage.',
      );
      return;
    }

    this.client = new S3Client({
      endpoint,
      region: this.config.get<string>('storage.region') ?? 'us-east-1',
      credentials: { accessKeyId: key, secretAccessKey: secret },
      // DO Spaces usa subdominios por bucket (bucket.endpoint), no path-style.
      forcePathStyle: false,
    });
    this.bucket = bucket;
    this.prefix = this.config.get<string>('storage.prefix') ?? 'afip-hub';

    this.logger.log(`Storage listo: ${endpoint} / bucket=${bucket} / prefix=${this.prefix}`);
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Path dentro del bucket para una invoice archivada. */
  keyForInvoice(organizationId: string, invoiceId: string): string {
    return `${this.prefix}/orgs/${organizationId}/invoices/${invoiceId}.json`;
  }

  async putJson(key: string, data: unknown): Promise<void> {
    this.requireClient();
    const body = JSON.stringify(data);
    try {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          // Si DO lo soporta: server-side encryption AES256. Es gratis.
          ServerSideEncryption: 'AES256',
        }),
      );
      this.logger.debug(`Storage PUT ${key} (${body.length} bytes)`);
    } catch (err) {
      this.logger.error(`Storage PUT ${key} falló: ${String(err)}`);
      throw err;
    }
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    this.requireClient();
    try {
      const resp = await this.client!.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await resp.Body?.transformToString();
      if (!body) return null;
      return JSON.parse(body) as T;
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.Code === 'NoSuchKey') {
        return null;
      }
      this.logger.error(`Storage GET ${key} falló: ${String(err)}`);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    this.requireClient();
    try {
      await this.client!.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404) return;
      this.logger.warn(`Storage DELETE ${key} falló: ${String(err)}`);
    }
  }

  private requireClient(): void {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Storage no configurado (SPACES_ENDPOINT/BUCKET/KEY/SECRET).',
      );
    }
  }
}
