import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Cliente de HashiCorp Vault (KV v2) para guardar certificados AFIP.
 *
 * Convención de paths:
 *   {basePath}/orgs/{orgId}/certs/{certId}
 * Payload ejemplo:
 *   { certificate: "<PEM>", privateKey: "<PEM>" }
 *
 * En dev sin `VAULT_ADDR`, las operaciones lanzan `ServiceUnavailableException`
 * (NO hay fallback a DB como con Redis — el cert es material sensible; si no
 * hay vault, no habilitamos la feature).
 */
@Injectable()
export class VaultService implements OnModuleInit {
  private readonly logger = new Logger(VaultService.name);
  private client: AxiosInstance | null = null;
  private kvMount!: string;
  private basePath!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const addr = this.config.get<string>('vault.addr');
    const token = this.config.get<string>('vault.token');
    this.kvMount = this.config.get<string>('vault.kvMount') ?? 'secret';
    this.basePath = this.config.get<string>('vault.basePath') ?? 'afip-hub';

    if (!addr || !token) {
      this.logger.warn(
        'VAULT_ADDR/VAULT_TOKEN no configurado — feature de certificados deshabilitada (ScheduledTasks no va a arrancar).',
      );
      return;
    }

    const headers: Record<string, string> = { 'X-Vault-Token': token };
    const ns = this.config.get<string>('vault.namespace');
    if (ns) headers['X-Vault-Namespace'] = ns;

    this.client = axios.create({
      baseURL: addr.replace(/\/$/, ''),
      timeout: 10000,
      headers,
    });

    // Verificación perezosa: ping /v1/sys/health para chequear conectividad.
    this.client.get('/v1/sys/health').then(
      () => this.logger.log(`Vault conectado (${addr})`),
      (err) => {
        this.logger.error(
          `Vault NO responde a /sys/health: ${err.message}. Revisar VAULT_ADDR/TOKEN.`,
        );
      },
    );
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  /** Path completo en Vault para un cert de una org. */
  pathForCertificate(orgId: string, certId: string): string {
    return `${this.basePath}/orgs/${orgId}/certs/${certId}`;
  }

  async writeSecret(path: string, data: Record<string, unknown>): Promise<void> {
    this.requireClient();
    try {
      await this.client!.post(`/v1/${this.kvMount}/data/${path}`, { data });
      this.logger.log(`Vault WRITE ${path}`);
    } catch (err: any) {
      this.logger.error(
        `Vault WRITE ${path} falló: status=${err.response?.status} ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw new InternalServerErrorException('No se pudo guardar el secret en el vault');
    }
  }

  async readSecret<T = Record<string, unknown>>(path: string): Promise<T | null> {
    this.requireClient();
    try {
      const { data } = await this.client!.get(`/v1/${this.kvMount}/data/${path}`);
      return (data?.data?.data ?? null) as T | null;
    } catch (err: any) {
      if (err.response?.status === 404) return null;
      this.logger.error(
        `Vault READ ${path} falló: status=${err.response?.status} ${JSON.stringify(err.response?.data ?? err.message)}`,
      );
      throw new InternalServerErrorException('No se pudo leer el secret del vault');
    }
  }

  /** Soft delete (versiona). Usar `destroy` para borrado físico. */
  async deleteSecret(path: string): Promise<void> {
    this.requireClient();
    try {
      await this.client!.delete(`/v1/${this.kvMount}/metadata/${path}`);
      this.logger.log(`Vault DELETE ${path}`);
    } catch (err: any) {
      if (err.response?.status === 404) return;
      this.logger.error(
        `Vault DELETE ${path} falló: status=${err.response?.status}`,
      );
      // No tiramos — borrar en vault es idempotente de facto
    }
  }

  private requireClient(): void {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Vault no configurado. Seteá VAULT_ADDR y VAULT_TOKEN.',
      );
    }
  }
}
