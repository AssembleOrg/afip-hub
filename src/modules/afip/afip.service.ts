/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as soap from 'soap';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import * as xml2js from 'xml2js';
import * as crypto from 'node:crypto';
import { RedisService } from '@/infra/redis';
import { resilientCall } from '@/infra/resilience';
import { AfipTicketDto } from './dto';
import {
  CreateInvoiceDto,
  CondicionIvaReceptor,
  getClaseComprobante,
  esNotaCreditoDebito,
  esFacturaCreditoElectronica,
  getCondicionesIvaValidas,
} from './dto/create-invoice.dto';
import { InvoiceResponseDto, QrDataDto } from './dto/invoice-response.dto';
import { NotaCreditoValidator } from './validators/nota-credito.validator';
import {
  ConsultarContribuyenteDto,
  ContribuyenteResponseDto,
} from './dto/consultar-contribuyente.dto';

interface CachedTicket {
  ticket: AfipTicketDto;
  expiresAt: Date;
}

interface PendingTicketRequest {
  promise: Promise<AfipTicketDto>;
  startTime: Date;
}

/** Formato serializado para persistir en disco */
interface PersistedTicketCache {
  [cacheKey: string]: {
    ticket: AfipTicketDto;
    expiresAt: string; // ISO
  };
}

@Injectable()
export class AfipService implements OnModuleInit {
  private readonly logger = new Logger(AfipService.name);
  private wsaaUrl: string;

  // Cache de tickets en memoria (clave: service + hash(certificado) + homologacion)
  private ticketCache: Map<string, CachedTicket> = new Map();

  // Mapa de tickets en progreso para evitar race conditions
  private pendingTicketRequests: Map<string, PendingTicketRequest> = new Map();

  // Persistencia en disco: ruta del archivo (null = no persistir)
  private ticketCacheFilePath: string | null = null;
  private persistWritePromise: Promise<void> = Promise.resolve();

  // URLs por defecto según entorno
  private readonly AFIP_URLS = {
    production: {
      wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms?WSDL',
      wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
      padron:
        'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL',
      ventanilla:
        'https://infraestructura.afip.gob.ar/ve-ws/services/veconsumer?wsdl',
      wscdc: 'https://servicios1.arca.gov.ar/WSCDC/service.asmx?WSDL',
    },
    homologacion: {
      wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?WSDL',
      wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL',
      padron:
        'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13?WSDL',
      ventanilla:
        'https://stable-middleware-tecno-ext.afip.gob.ar/ve-ws/services/veconsumer?wsdl',
      wscdc: 'https://wswhomo.arca.gov.ar/WSCDC/service.asmx?WSDL',
    },
  };

  constructor(
    private configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.wsaaUrl = this.configService.get<string>('afip.wsaaUrl') || '';
    const configuredPath =
      this.configService.get<string>('afip.ticketCachePath') || '';
    this.ticketCacheFilePath = configuredPath.trim()
      ? configuredPath.trim()
      : path.join(process.cwd(), '.afip-ticket-cache.json');
  }

  async onModuleInit(): Promise<void> {
    await this.loadTicketCacheFromFile();
  }

  /**
   * Obtiene las URLs de AFIP según el parámetro homologacion del request.
   * El parámetro homologacion tiene prioridad sobre la config global, para que
   * cada request pueda elegir entorno (multi-tenant / retry con mismo entorno).
   * @param homologacion - true para homologación (testing), false para producción. Default: false (producción)
   * @returns URLs del entorno seleccionado
   */
  private getAfipUrls(homologacion: boolean = false) {
    const env = homologacion ? 'homologacion' : 'production';
    const defaultUrls = this.AFIP_URLS[env];
    // Usar siempre las URLs del entorno solicitado en el request; no sobrescribir con config
    // para que homologacion=true siempre use wsaahomo/wsfe homo y no la URL de producción.
    return {
      wsaa: defaultUrls.wsaa,
      wsfe: defaultUrls.wsfe,
      padron: defaultUrls.padron,
      ventanilla: defaultUrls.ventanilla,
      wscdc: defaultUrls.wscdc,
    };
  }

  /**
   * Genera un Ticket de Acceso (TA) para autenticarse con los servicios de AFIP
   *
   * @param service - Nombre del servicio de AFIP (ej: 'wsfe', 'wsfex', 'wsbfe')
   * @param certificado - Certificado en formato PEM (texto completo o base64)
   * @param clavePrivada - Clave privada en formato PEM (texto completo o base64)
   * @returns Promise<AfipTicketDto> - Ticket con token, sign y fechas de validez
   *
   * @example
   * // Obtener ticket para Facturación Electrónica
   * const ticket = await afipService.getTicket('wsfe', certificado, clavePrivada);
   * console.log('Token:', ticket.token);
   * console.log('Válido hasta:', ticket.expirationTime);
   *
   * @description
   * Este método realiza el siguiente flujo:
   * 1. Crea un TRA (Ticket de Requerimiento de Acceso) en formato XML
   * 2. Firma el TRA con el certificado digital de AFIP
   * 3. Envía el TRA firmado al WSAA (Web Service de Autenticación y Autorización)
   * 4. Recibe y parsea el TA (Ticket de Acceso) que es válido por 12 horas
   *
   * El ticket obtenido se usa luego para autenticarse en otros servicios de AFIP
   * incluyendo el token y sign en los headers SOAP de cada llamada.
   */
  async getTicket(
    service: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<AfipTicketDto> {
    // Generar clave única para el cache: service + hash(certificado) + entorno
    const certHash = crypto
      .createHash('sha256')
      .update(certificado)
      .digest('hex')
      .substring(0, 16);
    const cacheKey = `${service}_${certHash}_${homologacion ? 'homo' : 'prod'}`;

    // 1. Verificar si hay un ticket válido en cache (memoria)
    const cached = this.ticketCache.get(cacheKey);
    if (cached) {
      const now = new Date();
      // Verificar si el ticket sigue siendo válido (con margen de 5 minutos)
      const margin = 5 * 60 * 1000; // 5 minutos en milisegundos
      const expiresAtWithMargin = new Date(cached.expiresAt.getTime() - margin);

      if (now < expiresAtWithMargin) {
        this.logger.log(`=== TICKET DESDE CACHE (memoria) ===`);
        this.logger.log(
          `Servicio: ${service}, Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`,
        );
        this.logger.log(`Válido hasta: ${cached.expiresAt.toISOString()}`);
        return cached.ticket;
      } else {
        // Ticket expirado, remover del cache
        this.logger.log(`Ticket en cache expirado, solicitando nuevo...`);
        this.ticketCache.delete(cacheKey);
      }
    }

    // 1.b Intentar Redis distribuido — compartido entre instancias.
    const fromRedis = await this.readTicketFromRedis(cacheKey);
    if (fromRedis) {
      this.ticketCache.set(cacheKey, fromRedis);
      this.logger.log(`=== TICKET DESDE CACHE (redis) ===`);
      this.logger.log(`Válido hasta: ${fromRedis.expiresAt.toISOString()}`);
      return fromRedis.ticket;
    }

    // 2. Verificar si ya hay una request en progreso para este cacheKey
    const pendingRequest = this.pendingTicketRequests.get(cacheKey);
    if (pendingRequest) {
      this.logger.log(`=== ESPERANDO TICKET EN PROGRESO ===`);
      this.logger.log(
        `Servicio: ${service}, hay una solicitud en curso, esperando resultado...`,
      );
      try {
        // Esperar al resultado de la request existente
        const ticket = await pendingRequest.promise;
        this.logger.log(
          `Ticket recibido de request en progreso para ${service}`,
        );
        return ticket;
      } catch (error) {
        // Si la request en progreso falló, intentaremos obtener uno nuevo
        this.logger.warn(
          `Request en progreso falló, intentando nueva solicitud...`,
        );
        // La request pendiente ya se eliminó en el finally del obtainTicketFromWSAA
      }
    }

    // 3. No hay ticket en cache ni request en progreso, crear nueva solicitud
    const ticketPromise = this.obtainTicketFromWSAA(
      service,
      certificado,
      clavePrivada,
      homologacion,
      cacheKey,
    );

    // Registrar esta request como pendiente
    this.pendingTicketRequests.set(cacheKey, {
      promise: ticketPromise,
      startTime: new Date(),
    });

    try {
      const ticket = await ticketPromise;
      return ticket;
    } finally {
      // Limpiar la request pendiente cuando termine (éxito o error)
      this.pendingTicketRequests.delete(cacheKey);
    }
  }

  /**
   * Método privado que realiza la obtención real del ticket desde WSAA
   * Se separa de getTicket para poder manejar el bloqueo de requests concurrentes
   */
  private async obtainTicketFromWSAA(
    service: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean,
    cacheKey: string,
  ): Promise<AfipTicketDto> {
    try {
      this.logger.log(`=== INICIO OBTENCIÓN DE TICKET ===`);
      this.logger.log(`Servicio solicitado: ${service}`);
      this.logger.log(
        `Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`,
      );

      // Paso 1: Crear el TRA (Ticket de Requerimiento de Acceso)
      const tra = this.createTRA(service);
      this.logger.log('TRA generado:');
      this.logger.log(tra);

      // Paso 2: Firmar el TRA con el certificado digital
      this.logger.log('Firmando TRA con certificado...');
      const signedTra = this.signTRA(tra, certificado, clavePrivada);
      this.logger.log(
        `CMS generado (primeros 100 caracteres): ${signedTra.substring(0, 100)}...`,
      );

      // Paso 3: Llamar al servicio WSAA para obtener el TA
      this.logger.log('Llamando a WSAA...');
      const urls = this.getAfipUrls(homologacion);
      const ticket = await this.callWSAA(signedTra, urls.wsaa);

      // Guardar en cache (memoria + disco + Redis). AFIP devuelve ISO o formato compacto
      const expirationDate = this.parseAfipDate(ticket.expirationTime);
      this.ticketCache.set(cacheKey, {
        ticket,
        expiresAt: expirationDate,
      });
      this.persistTicketCache();
      void this.writeTicketToRedis(cacheKey, ticket, expirationDate);

      // Limpiar tickets expirados del cache
      this.cleanExpiredTickets();

      this.logger.log(`=== TICKET OBTENIDO ===`);
      this.logger.log(
        `Token (primeros 50 caracteres): ${ticket.token.substring(0, 50)}...`,
      );
      this.logger.log(`Válido desde: ${ticket.generationTime}`);
      this.logger.log(`Válido hasta: ${ticket.expirationTime}`);
      this.logger.log('=== FIN OBTENCIÓN DE TICKET ===');

      return ticket;
    } catch (error: any) {
      // Si el error es "alreadyAuthenticated", AFIP ya tiene un TA válido pero nosotros no lo tenemos
      if (
        error.message?.includes('alreadyAuthenticated') ||
        error.message?.includes('ya posee un TA valido')
      ) {
        this.logger.warn(
          'AFIP reporta ticket ya autenticado; intentando recuperar desde caché persistido...',
        );

        // Primero cargar desde disco (por si reiniciamos y teníamos el ticket guardado)
        await this.loadTicketCacheFromFile();
        let cached = this.ticketCache.get(cacheKey);
        if (cached) {
          const now = new Date();
          const margin = 5 * 60 * 1000;
          const expiresAtWithMargin = new Date(
            cached.expiresAt.getTime() - margin,
          );
          if (now < expiresAtWithMargin) {
            this.logger.log('Usando ticket recuperado del caché persistido');
            return cached.ticket;
          }
        }

        // Esperar antes de reintentar (AFIP puede tardar en liberar)
        await new Promise((resolve) => setTimeout(resolve, 3000));

        cached = this.ticketCache.get(cacheKey);
        if (cached) {
          const now = new Date();
          const margin = 5 * 60 * 1000;
          const expiresAtWithMargin = new Date(
            cached.expiresAt.getTime() - margin,
          );

          if (now < expiresAtWithMargin) {
            this.logger.log(
              'Usando ticket del cache después de error alreadyAuthenticated',
            );
            return cached.ticket;
          }
        }

        // Reintentar una vez más después de esperar
        this.logger.log('Reintentando obtención de ticket...');
        await new Promise((resolve) => setTimeout(resolve, 2000));

        try {
          const tra = this.createTRA(service);
          const signedTra = this.signTRA(tra, certificado, clavePrivada);
          const urls = this.getAfipUrls(homologacion);
          const ticket = await this.callWSAA(signedTra, urls.wsaa);

          // Guardar en cache (memoria + disco + Redis)
          const expirationDate = this.parseAfipDate(ticket.expirationTime);
          this.ticketCache.set(cacheKey, {
            ticket,
            expiresAt: expirationDate,
          });
          this.persistTicketCache();
          void this.writeTicketToRedis(cacheKey, ticket, expirationDate);

          this.logger.log('Ticket obtenido en reintento');
          return ticket;
        } catch (retryError: any) {
          // Si sigue fallando, intentar cargar desde disco (por si había ticket antes del reinicio)
          await this.loadTicketCacheFromFile();
          const cachedRetry = this.ticketCache.get(cacheKey);
          if (cachedRetry) {
            const now = new Date();
            const margin = 5 * 60 * 1000;
            const expiresAtWithMargin = new Date(
              cachedRetry.expiresAt.getTime() - margin,
            );

            if (now < expiresAtWithMargin) {
              this.logger.log(
                'Usando ticket del cache después de segundo reintento fallido',
              );
              return cachedRetry.ticket;
            }
          }

          throw new BadRequestException(
            'AFIP indica que ya existe un ticket válido pero no se pudo recuperar. ' +
              'Esto puede ocurrir si hay múltiples requests simultáneas. ' +
              'Por favor, espera unos segundos e intenta nuevamente.',
          );
        }
      }

      this.logger.error(`Error al obtener ticket: ${error.message}`);
      this.logger.error(`Stack: ${error.stack}`);
      throw new BadRequestException(
        `Error al obtener ticket de AFIP: ${error.message}`,
      );
    }
  }

  /**
   * Limpia tickets expirados del cache para evitar acumulación de memoria
   */
  private cleanExpiredTickets(): void {
    const now = new Date();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.ticketCache.entries()) {
      if (now >= cached.expiresAt) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.ticketCache.delete(key));

    // Si el cache tiene más de 100 entradas, limpiar las más antiguas
    if (this.ticketCache.size > 100) {
      const entries = Array.from(this.ticketCache.entries());
      entries.sort(
        (a, b) => a[1].expiresAt.getTime() - b[1].expiresAt.getTime(),
      );

      for (let i = 0; i < 50 && i < entries.length; i++) {
        this.ticketCache.delete(entries[i][0]);
      }
    }

    this.persistTicketCache();
  }

  /**
   * Lee ticket cacheado desde Redis. Sirve para compartir tickets entre
   * múltiples instancias de la app: si el replica A consigue el TA, el
   * replica B lo reutiliza sin pegar a WSAA.
   *
   * Si Redis no está disponible, devuelve null sin loguear ruido.
   */
  private async readTicketFromRedis(
    cacheKey: string,
  ): Promise<CachedTicket | null> {
    const res = await this.redis.safeCall((r) =>
      r.get(`afip:ticket:${cacheKey}`),
    );
    if (!res.ok || !res.value) return null;
    try {
      const parsed = JSON.parse(res.value);
      const expiresAt = new Date(parsed.expiresAt);
      const margin = 5 * 60 * 1000;
      if (Date.now() >= expiresAt.getTime() - margin) return null;
      return { ticket: parsed.ticket, expiresAt };
    } catch {
      return null;
    }
  }

  private async writeTicketToRedis(
    cacheKey: string,
    ticket: AfipTicketDto,
    expiresAt: Date,
  ): Promise<void> {
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) {
      return;
    }
    const ttlSec = Math.max(
      60,
      Math.floor((expiresAt.getTime() - Date.now()) / 1000) - 300, // margen 5 min
    );
    await this.redis.safeCall((r) =>
      r.set(
        `afip:ticket:${cacheKey}`,
        JSON.stringify({ ticket, expiresAt: expiresAt.toISOString() }),
        'EX',
        ttlSec,
      ),
    );
  }

  /**
   * Carga el caché de tickets desde disco (al iniciar o tras alreadyAuthenticated).
   * Sobrevive reinicios del servidor para no pedir un TA nuevo si ya teníamos uno válido.
   */
  private async loadTicketCacheFromFile(): Promise<void> {
    if (!this.ticketCacheFilePath) return;
    try {
      const data = await fs.promises.readFile(this.ticketCacheFilePath, 'utf8');
      const parsed: PersistedTicketCache = JSON.parse(data);
      const now = new Date();
      const margin = 5 * 60 * 1000; // 5 min margen
      let loaded = 0;
      for (const [key, item] of Object.entries(parsed)) {
        const expiresAt = new Date(item.expiresAt);
        if (now.getTime() < expiresAt.getTime() - margin) {
          this.ticketCache.set(key, { ticket: item.ticket, expiresAt });
          loaded++;
        }
      }
      if (loaded > 0) {
        this.logger.log(
          `Caché de tickets AFIP: cargados ${loaded} ticket(s) desde ${this.ticketCacheFilePath}`,
        );
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        this.logger.warn(`No se pudo cargar caché de tickets: ${err.message}`);
      }
    }
  }

  /**
   * Persiste el caché de tickets en disco para sobrevivir reinicios.
   */
  private persistTicketCache(): void {
    if (!this.ticketCacheFilePath || this.ticketCache.size === 0) return;
    const obj: PersistedTicketCache = {};
    for (const [key, cached] of this.ticketCache.entries()) {
      const expiresAt = cached.expiresAt;
      // Evitar Invalid time value si la fecha no se parseó bien
      const expiresAtStr =
        expiresAt instanceof Date && Number.isFinite(expiresAt.getTime())
          ? expiresAt.toISOString()
          : new Date(Date.now() + 11 * 60 * 60 * 1000).toISOString(); // fallback: +11h
      obj[key] = {
        ticket: cached.ticket,
        expiresAt: expiresAtStr,
      };
    }
    const payload = JSON.stringify(obj, null, 0);
    this.persistWritePromise = this.persistWritePromise
      .then(() =>
        fs.promises.writeFile(this.ticketCacheFilePath!, payload, 'utf8'),
      )
      .catch((err) =>
        this.logger.warn(`No se pudo guardar caché de tickets: ${err.message}`),
      );
  }

  /**
   * Crea el XML del TRA (Ticket de Requerimiento de Acceso)
   * IMPORTANTE: NO incluir la declaración <?xml ...?> ya que AFIP no la acepta
   * Estructura según especificación oficial de AFIP
   *
   * AFIP recomienda una ventana de 10 minutos para generationTime y expirationTime
   */
  private createTRA(service: string): string {
    const now = new Date();
    // AFIP recomienda: generationTime = ahora - 10 minutos, expirationTime = ahora + 10 minutos
    const generationTime = new Date(now.getTime() - 10 * 60 * 1000); // 10 minutos antes
    const expirationTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutos después

    // Generar el TRA SIN la declaración XML y SIN espacios/saltos de línea antes
    // AFIP requiere que el XML comience directamente con <loginTicketRequest>
    // Estructura simplificada sin source/destination
    const tra = `<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Date.now() / 1000)}</uniqueId>
    <generationTime>${this.formatDate(generationTime)}</generationTime>
    <expirationTime>${this.formatDate(expirationTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;

    // Asegurar que no haya espacios o saltos de línea antes del primer tag
    return tra.trim();
  }

  /**
   * Firma el TRA con el certificado usando OpenSSL y genera el CMS (PKCS#7) en base64
   * El CMS se genera en formato DER y se codifica en base64 para enviarlo a AFIP
   *
   * @param tra - XML del TRA a firmar
   * @param certificado - Certificado en formato PEM (texto completo o base64)
   * @param clavePrivada - Clave privada en formato PEM (texto completo o base64)
   * @returns CMS firmado en base64
   */
  private signTRA(
    tra: string,
    certificado: string,
    clavePrivada: string,
  ): string {
    if (!certificado || !clavePrivada) {
      throw new BadRequestException(
        'Certificado y clave privada son requeridos',
      );
    }

    // Crear directorio temporal si no existe
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    const traPath = path.join(tmpDir, `TRA-${timestamp}.xml`);
    const certPath = path.join(tmpDir, `cert-${timestamp}.crt`);
    const keyPath = path.join(tmpDir, `key-${timestamp}.key`);

    try {
      // Decodificar certificado si viene en base64
      let certContent = certificado;
      if (!certificado.includes('-----BEGIN')) {
        try {
          certContent = Buffer.from(certificado, 'base64').toString('utf8');
        } catch {
          // Si falla, asumir que ya está en texto plano
          certContent = certificado;
        }
      }

      // Decodificar clave privada si viene en base64
      let keyContent = clavePrivada;
      if (!clavePrivada.includes('-----BEGIN')) {
        try {
          keyContent = Buffer.from(clavePrivada, 'base64').toString('utf8');
        } catch {
          // Si falla, asumir que ya está en texto plano
          keyContent = clavePrivada;
        }
      }

      // Validar que el contenido tenga los headers correctos
      if (
        !certContent.includes('-----BEGIN') ||
        !certContent.includes('-----END')
      ) {
        throw new BadRequestException(
          'El certificado debe estar en formato PEM con headers -----BEGIN/END-----',
        );
      }

      if (
        !keyContent.includes('-----BEGIN') ||
        !keyContent.includes('-----END')
      ) {
        throw new BadRequestException(
          'La clave privada debe estar en formato PEM con headers -----BEGIN/END-----',
        );
      }

      // Escribir archivos temporales
      fs.writeFileSync(traPath, tra, 'utf8');
      fs.writeFileSync(certPath, certContent, 'utf8');
      fs.writeFileSync(keyPath, keyContent, 'utf8');

      // Establecer permisos restrictivos para la clave privada (solo lectura para el propietario)
      fs.chmodSync(keyPath, 0o600);

      // Ejecutar OpenSSL para generar el CMS en formato DER (binario)
      // -sign: firmar el mensaje
      // -signer: certificado a usar
      // -inkey: clave privada
      // -outform DER: salida en formato DER (binario)
      // -nodetach: incluir el contenido en el CMS (no detached)
      // -binary: salida binaria
      const cmd = `openssl smime -sign -signer "${certPath}" -inkey "${keyPath}" -outform DER -nodetach -binary -in "${traPath}" 2>&1`;

      let cmsBuffer: Buffer;
      try {
        cmsBuffer = execSync(cmd, { encoding: 'buffer' });
      } catch (execError: any) {
        const errorOutput =
          execError.stderr?.toString() ||
          execError.stdout?.toString() ||
          execError.message;
        throw new Error(`OpenSSL error: ${errorOutput}`);
      }

      // Convertir el buffer binario a base64 (sin headers -----BEGIN/END-----)
      const cmsBase64 = cmsBuffer.toString('base64');

      return cmsBase64;
    } catch (error: any) {
      throw new BadRequestException(`Error al firmar el TRA: ${error.message}`);
    } finally {
      // Limpiar archivos temporales
      try {
        if (fs.existsSync(traPath)) fs.unlinkSync(traPath);
        if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
        if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      } catch (cleanupError) {
        // Ignorar errores de limpieza
        this.logger.warn(
          `Error al limpiar archivos temporales: ${cleanupError}`,
        );
      }
    }
  }

  /**
   * Llama al servicio WSAA para obtener el Ticket de Acceso. Envuelto en
   * `resilientCall` con retries (3, exp backoff) y circuit breaker por
   * entorno. El error "alreadyAuthenticated" no es retryable (lo maneja la
   * lógica de arriba que recupera el ticket del caché).
   */
  private async callWSAA(
    signedTra: string,
    wsaaUrl?: string,
  ): Promise<AfipTicketDto> {
    const isHomo = (wsaaUrl ?? '').includes('homo');
    return resilientCall(() => this._callWSAARaw(signedTra, wsaaUrl), {
      name: `afip-wsaa-${isHomo ? 'homo' : 'prod'}`,
      maxAttempts: 3,
      baseBackoffMs: 1000,
      perAttemptTimeoutMs: 30000,
      shouldRetry: (err) => {
        const msg = String((err as any)?.message ?? err).toLowerCase();
        // No reintentamos errores de negocio que no van a cambiar al reintentar
        if (
          msg.includes('alreadyauthenticated') ||
          msg.includes('ya posee un ta')
        )
          return false;
        if (msg.includes('certificado') || msg.includes('clave privada'))
          return false;
        return true;
      },
    });
  }

  private async _callWSAARaw(
    signedTra: string,
    wsaaUrl?: string,
  ): Promise<AfipTicketDto> {
    return new Promise((resolve, reject) => {
      // Usar la URL proporcionada o la del config, asegurando que termine con ?WSDL
      const url = wsaaUrl || this.wsaaUrl;
      const finalUrl = url.includes('?WSDL') ? url : `${url}?WSDL`;

      this.logger.log(`Conectando a WSAA: ${finalUrl}`);

      // Opciones para el cliente SOAP de AFIP
      const soapOptions = {
        wsdl_options: {
          timeout: 30000,
          connection_timeout: 10000,
        },
        disableCache: true,
        // Forzar el uso de HTTP/HTTPS
        forceSoap12Headers: false,
        // NO usar escapeXML: false - el CMS ya viene en base64, debe escaparse si es necesario
      };

      soap.createClient(finalUrl, soapOptions, (err, client) => {
        if (err) {
          this.logger.error(`Error al crear cliente SOAP: ${err.message}`);
          reject(
            new Error(
              `Error al crear cliente SOAP: ${err.message}. URL: ${finalUrl}`,
            ),
          );
          return;
        }

        if (!client || !client.loginCms) {
          this.logger.error(`El cliente SOAP no tiene el método loginCms`);
          reject(
            new Error(
              `El cliente SOAP no tiene el método loginCms. Verifica la URL: ${wsaaUrl}`,
            ),
          );
          return;
        }

        this.logger.log(
          'Cliente SOAP creado correctamente, llamando loginCms...',
        );

        client.loginCms({ in0: signedTra }, async (err: any, result: any) => {
          if (err) {
            this.logger.error(
              `Error al llamar WSAA: ${err.message || JSON.stringify(err)}`,
            );
            reject(
              new Error(
                `Error al llamar WSAA: ${err.message || JSON.stringify(err)}`,
              ),
            );
            return;
          }

          try {
            this.logger.log('Respuesta recibida de WSAA, parseando...');
            // Parsear el XML de respuesta para extraer el ticket
            const ticket = await this.parseTicketResponse(
              result.loginCmsReturn,
            );
            this.logger.log('Ticket parseado correctamente');
            resolve(ticket);
          } catch (parseError: any) {
            this.logger.error(
              `Error al parsear respuesta: ${parseError.message}`,
            );
            this.logger.error(
              `Respuesta recibida: ${JSON.stringify(result, null, 2)}`,
            );
            reject(
              new Error(`Error al parsear respuesta: ${parseError.message}`),
            );
          }
        });
      });
    });
  }

  /**
   * Parsea fecha devuelta por AFIP (ISO o formato compacto YYYYMMDDTHHmmss) a Date válido.
   */
  private parseAfipDate(value: string): Date {
    if (!value || typeof value !== 'string') {
      return new Date(Date.now() + 11 * 60 * 60 * 1000);
    }
    const trimmed = value.trim();
    let d = new Date(trimmed);
    if (Number.isFinite(d.getTime())) return d;
    // Formato compacto: 20260203172557 o 20260203T172557
    const match = trimmed.match(
      /^(\d{4})(\d{2})(\d{2})[T\s]?(\d{2})?(\d{2})?(\d{2})?/,
    );
    if (match) {
      const [, y, mo, day, h = '00', mi = '00', s = '00'] = match;
      d = new Date(
        Date.UTC(
          parseInt(y!, 10),
          parseInt(mo!, 10) - 1,
          parseInt(day!, 10),
          parseInt(h, 10),
          parseInt(mi, 10),
          parseInt(s, 10),
        ),
      );
      if (Number.isFinite(d.getTime())) return d;
    }
    return new Date(Date.now() + 11 * 60 * 60 * 1000);
  }

  /**
   * Parsea la respuesta XML del WSAA para extraer el ticket
   */
  private async parseTicketResponse(
    xmlResponse: string,
  ): Promise<AfipTicketDto> {
    return new Promise((resolve, reject) => {
      const parser = new xml2js.Parser({ explicitArray: false });
      parser.parseString(xmlResponse, (err, result) => {
        if (err) {
          reject(new Error(`Error al parsear XML: ${err.message}`));
          return;
        }

        try {
          const credentials = result.loginTicketResponse?.credentials;
          if (!credentials) {
            throw new Error('Formato de respuesta inválido');
          }

          // xml2js puede devolver valores como string o como objeto { _: "valor" }
          const str = (v: any): string =>
            typeof v === 'string'
              ? v
              : v && (v._ ?? v['#text'] ?? v)
                ? String(v._ ?? v['#text'] ?? v)
                : '';

          const ticket: AfipTicketDto = {
            token: str(credentials.token),
            sign: str(credentials.sign),
            expirationTime: str(credentials.expirationTime),
            generationTime: str(credentials.generationTime),
          };

          resolve(ticket);
        } catch (error) {
          reject(new Error(`Error al extraer ticket: ${error.message}`));
        }
      });
    });
  }

  /**
   * Formatea la fecha en el formato requerido por AFIP (ISO 8601 con timezone)
   * Formato: YYYY-MM-DDTHH:mm:ss-03:00 (GMT-3 Buenos Aires)
   */
  private formatDate(date: Date): string {
    // Convertir a hora de Buenos Aires (GMT-3)
    const buenosAiresOffset = -3 * 60; // -3 horas en minutos
    const localTime = date.getTime();
    const utcTime = localTime + date.getTimezoneOffset() * 60000;
    const buenosAiresTime = new Date(utcTime + buenosAiresOffset * 60000);

    // Formatear como YYYY-MM-DDTHH:mm:ss-03:00
    const year = buenosAiresTime.getFullYear();
    const month = String(buenosAiresTime.getMonth() + 1).padStart(2, '0');
    const day = String(buenosAiresTime.getDate()).padStart(2, '0');
    const hours = String(buenosAiresTime.getHours()).padStart(2, '0');
    const minutes = String(buenosAiresTime.getMinutes()).padStart(2, '0');
    const seconds = String(buenosAiresTime.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}-03:00`;
  }

  /**
   * Valida que el ticket no haya expirado
   */
  validateTicket(ticket: AfipTicketDto): boolean {
    const expiration = new Date(ticket.expirationTime);
    return expiration > new Date();
  }

  /**
   * Obtiene el último comprobante autorizado para un punto de venta y tipo de comprobante
   *
   * @param puntoVenta - Punto de venta
   * @param tipoComprobante - Tipo de comprobante
   * @param ticket - Ticket de acceso de AFIP
   * @returns Promise con el último número y fecha autorizados
   *
   * @example
   * const ultimo = await this.getUltimoAutorizado(1, 6, ticket);
   * console.log('Último número:', ultimo.CbteNro);
   * console.log('Última fecha:', ultimo.CbteFch);
   */
  async getUltimoAutorizado(
    puntoVenta: number,
    tipoComprobante: number,
    ticket: AfipTicketDto,
    cuit: string,
    homologacion: boolean = false,
  ): Promise<{ CbteNro: number; CbteFch: string }> {
    this.logger.log('=== INICIO getUltimoAutorizado ===');
    this.logger.log(`Punto de venta: ${puntoVenta}`);
    this.logger.log(`Tipo de comprobante: ${tipoComprobante}`);
    this.logger.log(`CUIT: ${cuit}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);
    this.logger.log(`Ticket: ${JSON.stringify(ticket, null, 2)}`);

    return new Promise((resolve, reject) => {
      const urls = this.getAfipUrls(homologacion);
      const wsfeUrl = urls.wsfe;

      this.logger.log(
        `Llamando FECompUltimoAutorizado PtoVta=${puntoVenta}, CbteTipo=${tipoComprobante}, CUIT=${cuit}`,
      );

      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          this.logger.error(
            `Error al crear cliente SOAP WSFE (FECompUltimoAutorizado): ${err.message}`,
          );
          reject(
            new BadRequestException(
              `Error al crear cliente SOAP WSFE: ${err.message}`,
            ),
          );
          return;
        }

        const req = {
          Auth: {
            Token: ticket.token,
            Sign: ticket.sign,
            Cuit: cuit,
          },
          PtoVta: puntoVenta,
          CbteTipo: tipoComprobante,
        };

        this.logger.log('=== REQUEST FECompUltimoAutorizado ===');
        this.logger.log(JSON.stringify(req, null, 2));

        client.FECompUltimoAutorizado(req, (err: any, result: any) => {
          this.logger.log('=== RESPONSE FECompUltimoAutorizado ===');
          this.logger.log(JSON.stringify(result, null, 2));
          this.logger.log('=== ERROR FECompUltimoAutorizado ===');
          this.logger.log(JSON.stringify(err, null, 2));
          if (err) {
            // Si el error es "Not Found" o similar, significa que no hay comprobantes previos
            // Esto es normal en la primera factura de un punto de venta/tipo
            const errorMessage = (
              err.message ||
              err.toString() ||
              ''
            ).toLowerCase();
            const errorString = JSON.stringify(err).toLowerCase();
            const errorBody = (err.body || '').toLowerCase();
            const errorRoot = (err.root || '').toLowerCase();

            // Verificar múltiples formas en que puede venir el error "Not Found"
            const isNotFound =
              errorMessage.includes('not found') ||
              errorMessage.includes('no encontrado') ||
              errorMessage.includes('404') ||
              errorString.includes('not found') ||
              errorString.includes('no encontrado') ||
              errorString.includes('404') ||
              errorBody.includes('not found') ||
              errorBody.includes('no encontrado') ||
              errorRoot.includes('not found') ||
              errorRoot.includes('no encontrado') ||
              err.statusCode === 404 ||
              err.status === 404;

            if (isNotFound) {
              this.logger.log(
                'No se encontraron comprobantes previos (primera factura). Usando valores por defecto.',
              );

              // Generar fecha actual en formato YYYYMMDD
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const fechaActual = `${year}${month}${day}`;

              resolve({ CbteNro: 0, CbteFch: fechaActual });
              return;
            }

            this.logger.error(
              `Error al llamar FECompUltimoAutorizado: ${err.message}`,
            );
            this.logger.error(
              `Error completo: ${JSON.stringify(err, null, 2)}`,
            );
            reject(
              new BadRequestException(
                `Error en FECompUltimoAutorizado: ${err.message}`,
              ),
            );
            return;
          }

          const data = result.FECompUltimoAutorizadoResult;

          this.logger.log('=== FECompUltimoAutorizadoResult ===');
          this.logger.log(JSON.stringify(data, null, 2));

          // Verificar errores
          if (data.Errors && data.Errors.length > 0) {
            // Si el error es que no se encontró el comprobante, es la primera factura
            const hasNotFoundError = data.Errors.some(
              (error: any) =>
                error.Code === 10015 || // Código específico de AFIP para "no encontrado"
                error.Msg?.toLowerCase().includes('no encontrado') ||
                error.Msg?.toLowerCase().includes('not found') ||
                error.Msg?.toLowerCase().includes('sin comprobantes'),
            );

            if (hasNotFoundError) {
              this.logger.log(
                'No se encontraron comprobantes previos (primera factura). Usando valores por defecto.',
              );

              // Generar fecha actual en formato YYYYMMDD
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const fechaActual = `${year}${month}${day}`;

              resolve({ CbteNro: 0, CbteFch: fechaActual });
              return;
            }

            this.logger.error('=== ERRORES EN FECompUltimoAutorizado ===');
            data.Errors.forEach((error: any, index: number) => {
              this.logger.error(
                `Error ${index + 1}: Code=${error.Code}, Msg=${error.Msg}`,
              );
            });
            const errorMsg = data.Errors.map(
              (e: any) => `${e.Code}: ${e.Msg}`,
            ).join(', ');
            reject(
              new BadRequestException(
                `Error de AFIP en FECompUltimoAutorizado: ${errorMsg}`,
              ),
            );
            return;
          }

          // Si CbteNro es 0 o no existe, y CbteFch está vacío, es la primera factura
          const ultimoNro = Number(data.CbteNro || 0);
          let ultimoFch = data.CbteFch || '';

          // Si no hay fecha, usar la fecha actual
          if (!ultimoFch || ultimoFch === '') {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            ultimoFch = `${year}${month}${day}`;
            this.logger.log(
              'No se encontró fecha del último comprobante. Usando fecha actual.',
            );
          }

          this.logger.log(
            `Último comprobante autorizado -> Nro: ${ultimoNro}, Fecha: ${ultimoFch}`,
          );

          resolve({ CbteNro: ultimoNro, CbteFch: ultimoFch });
        });
      });
    });
  }

  /**
   * Consulta datos de un contribuyente en AFIP usando el servicio Padrón A5
   *
   * @param consultaDto - DTO con CUIT a consultar, certificado, clave y CUIT emisor
   * @returns Promise<ContribuyenteResponseDto> - Datos del contribuyente consultado
   *
   * @example
   * const datos = await this.consultarContribuyente({
   *   cuit: '20386949604',
   *   cuitEmisor: '20123456789',
   *   certificado: '...',
   *   clavePrivada: '...'
   * });
   * console.log('Nombre:', datos.denominacion);
   * console.log('Condición IVA:', datos.condicionIva);
   */
  async consultarContribuyente(
    consultaDto: ConsultarContribuyenteDto,
  ): Promise<ContribuyenteResponseDto> {
    try {
      this.logger.log('=== INICIO CONSULTA CONTRIBUYENTE ===');
      this.logger.log(`CUIT a consultar: ${consultaDto.cuit}`);
      this.logger.log(`CUIT emisor: ${consultaDto.cuitEmisor}`);

      // Validar que se proporcionen certificado, clave y CUIT
      const certificado = consultaDto.certificado;
      const clavePrivada = consultaDto.clavePrivada;
      const cuitEmisorRaw = consultaDto.cuitEmisor;
      const cuitAConsultar = consultaDto.cuit.replace(/-/g, ''); // Remover guiones

      if (!certificado || !clavePrivada || !cuitEmisorRaw) {
        throw new BadRequestException(
          'certificado, clavePrivada y cuitEmisor son requeridos',
        );
      }

      const cuitEmisor = cuitEmisorRaw.replace(/-/g, ''); // Remover guiones
      const homologacion =
        consultaDto.homologacion !== undefined
          ? consultaDto.homologacion
          : false;

      // Obtener ticket del servicio Padrón A13 (ws_sr_padron_a13)
      // A13 es el servicio de padrón más actual que devuelve los datos completos
      // (denominación, tipoPersona, domicilio, impuestos, actividades, monotributo).
      this.logger.log('Obteniendo ticket del servicio ws_sr_padron_a13...');
      const ticket = await this.getTicket(
        'ws_sr_padron_a13',
        certificado,
        clavePrivada,
        homologacion,
      );
      this.logger.log(
        `Ticket obtenido, válido hasta: ${ticket.expirationTime}`,
      );

      // URL del servicio Padrón A13 (personaServiceA13)
      const urls = this.getAfipUrls(homologacion);
      const padronUrl = urls.padron;

      this.logger.log(`URL Padrón A13: ${padronUrl}`);

      return new Promise((resolve, reject) => {
        soap.createClient(padronUrl, (err: any, client: any) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP Padrón: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP Padrón: ${err.message}`,
              ),
            );
            return;
          }

          // Log métodos disponibles para debugging
          this.logger.log(
            'Métodos disponibles en el cliente Constancia de Inscripción:',
          );
          this.logger.log(
            Object.keys(client)
              .filter((key) => typeof client[key] === 'function')
              .join(', '),
          );

          // Estructura del request según documentación oficial Constancia de Inscripción v3.4
          // https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion-v3.4.pdf
          // IMPORTANTE: El servicio de Constancia de Inscripción requiere token y sign en el nivel raíz
          // NO dentro de un objeto auth (a diferencia de otros servicios como WSFE o WSCDC)
          const cuitEmisorClean = cuitEmisor.replace(/-/g, '');
          const cuitAConsultarClean = cuitAConsultar.replace(/-/g, '');

          const req = {
            token: ticket.token,
            sign: ticket.sign,
            cuitRepresentada: cuitEmisorClean,
            idPersona: cuitAConsultarClean,
          };

          this.logger.log(
            '=== REQUEST getPersona_v2 (Constancia de Inscripción) ===',
          );
          this.logger.log(`CUIT Emisor (limpio): ${cuitEmisorClean}`);
          this.logger.log(`CUIT a Consultar (limpio): ${cuitAConsultarClean}`);
          this.logger.log(
            `Token (primeros 50 chars): ${ticket.token.substring(0, 50)}...`,
          );
          this.logger.log(
            `Sign (primeros 50 chars): ${ticket.sign.substring(0, 50)}...`,
          );
          this.logger.log('Request completo: ' + JSON.stringify(req, null, 2));

          // Método según documentación v3.4: getPersona_v2 (versión más reciente)
          // También existe getPersona pero se recomienda usar _v2
          const methodName = client.getPersona_v2
            ? 'getPersona_v2'
            : client.getPersona
              ? 'getPersona'
              : null;

          if (!methodName) {
            this.logger.error(
              'No se encontró método válido en el servicio de Constancia de Inscripción',
            );
            this.logger.error(
              'Métodos disponibles:',
              Object.keys(client).filter(
                (k) => typeof client[k] === 'function',
              ),
            );
            reject(
              new BadRequestException(
                'No se encontró método getPersona_v2 o getPersona en el servicio de Constancia de Inscripción de AFIP',
              ),
            );
            return;
          }

          this.logger.log(`Usando método: ${methodName}`);

          client[methodName](req, (err: any, result: any) => {
            this.logger.log(
              `=== RESPONSE ${methodName} (Constancia de Inscripción) ===`,
            );

            if (err) {
              this.logger.error(
                `Error al consultar contribuyente: ${err.message}`,
              );
              // Intentar loguear el error de forma segura
              try {
                this.logger.error(
                  'Error completo: ' + JSON.stringify(err, null, 2),
                );
              } catch (e) {
                this.logger.error(`Error (no serializable): ${err.toString()}`);
              }

              // Si el error es de autenticación, puede ser problema con el ID del servicio o el formato del request
              if (err.message && err.message.includes('firma valida')) {
                this.logger.error(
                  '⚠️ ERROR DE AUTENTICACIÓN: El ticket puede no ser válido para este servicio',
                );
                this.logger.error('Posibles causas:');
                this.logger.error(
                  '1. El ID del servicio usado para obtener el ticket no es correcto',
                );
                this.logger.error(
                  '2. El formato del request no es el esperado por el servicio',
                );
                this.logger.error(
                  '3. El certificado/clave privada no están registrados para este servicio',
                );
                this.logger.error(
                  `ID del servicio usado: ws_sr_constancia_inscripcion`,
                );
                this.logger.error(
                  'Verifica en el manual v3.4 si el ID del servicio es correcto',
                );
              }

              reject(
                new BadRequestException(
                  `Error al consultar contribuyente: ${err.message}. Si el error es de autenticación, verifica que el certificado esté registrado para el servicio de Constancia de Inscripción y que el ID del servicio sea correcto.`,
                ),
              );
              return;
            }

            // Parsear respuesta del servicio Padrón A13.
            // El WSDL devuelve { personaReturn: { persona: {...}, errorConstancia? } }.
            // Algunos clientes SOAP exponen `persona` directo en el root del result.
            const personaReturn = result?.personaReturn || result || {};
            const persona =
              personaReturn.persona ||
              personaReturn.Persona ||
              personaReturn ||
              {};

            try {
              this.logger.log('=== personaReturn (Padrón A13) ===');
              this.logger.log(
                JSON.stringify(
                  {
                    errorConstancia: personaReturn.errorConstancia,
                    idPersona: persona.idPersona,
                    tipoPersona: persona.tipoPersona,
                    estadoClave: persona.estadoClave,
                    razonSocial: persona.razonSocial,
                    nombre: persona.nombre,
                    apellido: persona.apellido,
                    impuesto: persona.impuesto,
                    categoria: persona.categoria,
                    domicilioFiscal: persona.domicilioFiscal,
                    domicilio: persona.domicilio,
                  },
                  null,
                  2,
                ),
              );
            } catch (e) {
              this.logger.log('personaReturn (no serializable)');
            }

            // Verificar errores explícitos del padrón
            if (personaReturn.errorConstancia) {
              this.logger.error(
                `Error de AFIP: ${personaReturn.errorConstancia}`,
              );
              reject(
                new BadRequestException(
                  `Error al consultar contribuyente: ${personaReturn.errorConstancia}`,
                ),
              );
              return;
            }

            // Validar que vino una persona en el response
            if (!persona || (!persona.idPersona && !persona.tipoPersona)) {
              reject(
                new BadRequestException(
                  'No se encontraron datos del contribuyente en el padrón A13',
                ),
              );
              return;
            }

            // ── Tipo de persona ─────────────────────────────────────────────
            const tipoPersona =
              persona.tipoPersona === 'FISICA'
                ? 'FISICA'
                : persona.tipoPersona === 'JURIDICA'
                  ? 'JURIDICA'
                  : persona.tipoPersona || 'FISICA';

            // ── Denominación ────────────────────────────────────────────────
            let denominacion = 'Sin denominación';
            if (tipoPersona === 'FISICA') {
              const nombre = persona.nombre || '';
              const apellido = persona.apellido || '';
              denominacion =
                `${apellido} ${nombre}`.trim() || 'Sin denominación';
            } else {
              denominacion = persona.razonSocial || 'Sin denominación';
            }

            // ── Estado ──────────────────────────────────────────────────────
            const estadoClave = persona.estadoClave || '';
            const estado =
              estadoClave === 'ACTIVO' || estadoClave === 'Activo'
                ? 'ACTIVO'
                : estadoClave === 'INACTIVO' || estadoClave === 'Inactivo'
                  ? 'INACTIVO'
                  : estadoClave || 'ACTIVO';

            // ── Condición IVA ───────────────────────────────────────────────
            // Padrón A13 devuelve `impuesto[]` con `idImpuesto` (catálogo AFIP):
            //   30 = IVA (Responsable Inscripto)
            //   32 = IVA Exento
            //   20 = Monotributo
            // estadoImpuesto: 'AC' = activo
            //
            // Y `categoria[]` cuando hay régimen Monotributo.
            //
            // Normalizamos a los códigos AFIP de facturación (condicionIvaReceptor)
            // que es lo que consume el cliente: 1=RI, 4=Exento, 5=CF, 6=Monotributo.
            const impuestos: any[] = Array.isArray(persona.impuesto)
              ? persona.impuesto
              : persona.impuesto
                ? [persona.impuesto]
                : [];
            const categorias: any[] = Array.isArray(persona.categoria)
              ? persona.categoria
              : persona.categoria
                ? [persona.categoria]
                : [];

            const isActivo = (item: any) => {
              const estado = (
                item?.estadoImpuesto ||
                item?.estado ||
                'AC'
              ).toString();
              return (
                estado === 'AC' || estado === 'ACTIVO' || estado === 'Activo'
              );
            };

            const tieneImpuesto = (id: number) =>
              impuestos.some(
                (i) => Number(i?.idImpuesto) === id && isActivo(i),
              );

            const tieneMonotributoEnCategoria = categorias.some(
              (c) =>
                isActivo(c) &&
                (Number(c?.idImpuesto) === 20 ||
                  /monotrib/i.test(c?.descripcionCategoria || '')),
            );

            let condicionIvaCodigo: number;
            let condicionIvaTexto: string;

            if (tieneImpuesto(20) || tieneMonotributoEnCategoria) {
              condicionIvaCodigo = 6;
              condicionIvaTexto = 'Monotributista';
            } else if (tieneImpuesto(32)) {
              condicionIvaCodigo = 4;
              condicionIvaTexto = 'IVA Exento';
            } else if (tieneImpuesto(30)) {
              condicionIvaCodigo = 1;
              condicionIvaTexto = 'Responsable Inscripto';
            } else {
              condicionIvaCodigo = 5;
              condicionIvaTexto = 'Consumidor Final';
            }

            // ── Domicilio ───────────────────────────────────────────────────
            // A13 trae `domicilioFiscal` (objeto único) y/o `domicilio[]` (array).
            // Preferimos `domicilioFiscal`; si no, el primer item de `domicilio[]`.
            let domicilio: any = undefined;
            if (persona.domicilioFiscal) {
              domicilio = persona.domicilioFiscal;
            } else if (
              Array.isArray(persona.domicilio) &&
              persona.domicilio.length > 0
            ) {
              domicilio =
                persona.domicilio.find((d: any) =>
                  (d?.tipoDomicilio || '')
                    .toString()
                    .toUpperCase()
                    .includes('FISCAL'),
                ) || persona.domicilio[0];
            } else if (persona.domicilio) {
              domicilio = persona.domicilio;
            }

            // ── Fecha de inscripción ────────────────────────────────────────
            const fechaInscripcion =
              persona.fechaInscripcion ||
              persona.fechaContratoSocial ||
              undefined;

            const response: ContribuyenteResponseDto = {
              cuit: cuitAConsultar,
              denominacion: denominacion,
              tipoPersona: tipoPersona,
              condicionIva: condicionIvaTexto,
              condicionIvaCodigo: condicionIvaCodigo,
              estado: estado,
              domicilio: domicilio,
              fechaInscripcion: fechaInscripcion,
            };

            this.logger.log('=== DATOS CONTRIBUYENTE (Padrón A13) ===');
            this.logger.log(JSON.stringify(response, null, 2));
            this.logger.log('=== FIN CONSULTA CONTRIBUYENTE ===');

            resolve(response);
          });
        });
      });
    } catch (error: any) {
      this.logger.error(
        `Error general al consultar contribuyente: ${error.message}`,
      );
      this.logger.error(`Stack: ${error.stack}`);
      throw new BadRequestException(
        `Error al consultar contribuyente: ${error.message}`,
      );
    }
  }

  /**
   * Crea una factura electrónica usando el servicio WSFE de AFIP
   *
   * @param invoiceData - Datos de la factura a crear
   * @param ticket - Ticket de acceso de AFIP (si no se proporciona, se obtiene uno nuevo)
   * @returns Promise<InvoiceResponseDto> - Respuesta con CAE y datos de la factura autorizada
   *
   * @example
   * // Obtener ticket primero
   * const ticket = await this.getTicket('wsfe');
   *
   * // Crear factura
   * const factura = await this.createInvoice({
   *   puntoVenta: 1,
   *   tipoComprobante: TipoComprobante.FACTURA_B,
   *   numeroComprobante: 0,
   *   fechaComprobante: '20241126',
   *   cuitCliente: '20123456789',
   *   tipoDocumento: TipoDocumento.CUIT,
   *   importeNetoGravado: 1000.0,
   *   importeIva: 210.0,
   *   importeTotal: 1210.0,
   *   concepto: 1
   * }, ticket);
   */
  async createInvoice(
    invoiceData: CreateInvoiceDto,
    ticket?: AfipTicketDto,
  ): Promise<InvoiceResponseDto> {
    try {
      this.logger.log('=== INICIO CREACIÓN DE FACTURA ===');
      this.logger.log(
        `Datos recibidos: ${JSON.stringify(invoiceData, null, 2)}`,
      );

      // Validar que se proporcionen certificado, clave y CUIT
      const certificado = (invoiceData as any).certificado;
      const clavePrivada = (invoiceData as any).clavePrivada;
      const cuitEmisorRaw = (invoiceData as any).cuitEmisor;

      if (!certificado || !clavePrivada || !cuitEmisorRaw) {
        throw new BadRequestException(
          'certificado, clavePrivada y cuitEmisor son requeridos',
        );
      }

      const cuitEmisor = cuitEmisorRaw.replace(/-/g, ''); // Remover guiones si los tiene
      const homologacion =
        invoiceData.homologacion !== undefined
          ? invoiceData.homologacion
          : false;
      this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
      this.logger.log(
        `Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`,
      );

      // Si no se proporciona ticket, obtener uno nuevo usando los certificados del request
      let authTicket = ticket;
      if (!authTicket || !this.validateTicket(authTicket)) {
        this.logger.log(
          'Ticket no válido o no proporcionado, obteniendo nuevo ticket...',
        );
        authTicket = await this.getTicket(
          'wsfe',
          certificado,
          clavePrivada,
          homologacion,
        );
        this.logger.log(
          `Ticket obtenido, válido hasta: ${authTicket.expirationTime}`,
        );
      } else {
        this.logger.log(
          `Usando ticket existente, válido hasta: ${authTicket.expirationTime}`,
        );
      }

      // URL del servicio WSFE (Facturación Electrónica)
      const urls = this.getAfipUrls(homologacion);
      const wsfeUrl = urls.wsfe;

      this.logger.log(`URL WSFE: ${wsfeUrl}`);

      // Obtener el último comprobante autorizado para calcular el próximo número
      this.logger.log('Obteniendo último comprobante autorizado...');
      let ultimo: { CbteNro: number; CbteFch: string };

      try {
        ultimo = await this.getUltimoAutorizado(
          invoiceData.puntoVenta,
          invoiceData.tipoComprobante,
          authTicket,
          cuitEmisor,
          homologacion,
        );
      } catch (error: any) {
        this.logger.error('=== ERROR EN getUltimoAutorizado ===');
        this.logger.error(JSON.stringify(error, null, 2));
        // Si el error es "Not Found", es la primera factura - usar valores por defecto
        const errorMessage = (error.message || '').toLowerCase();
        if (
          errorMessage.includes('not found') ||
          errorMessage.includes('no encontrado')
        ) {
          this.logger.log(
            'No se encontraron comprobantes previos (primera factura). Usando valores por defecto.',
          );
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const fechaActual = `${year}${month}${day}`;
          ultimo = { CbteNro: 0, CbteFch: fechaActual };
        } else {
          this.logger.error(
            'Error al obtener último comprobante autorizado: ' +
              JSON.stringify(error, null, 2),
          );
          // Re-lanzar otros errores
          throw error;
        }
      }

      const ultimoNumero = ultimo.CbteNro || 0;
      const proximoNumero = ultimoNumero + 1;
      const ultimaFecha = ultimo.CbteFch; // 'yyyyMMdd'

      this.logger.log(
        `Último autorizado -> Nro: ${ultimoNumero}, Fecha: ${ultimaFecha}`,
      );

      // Número: si el cliente manda 0 o null, usamos el próximo.
      // Si manda algo distinto al que corresponde, por ahora pisamos y logueamos.
      let numeroAUsar =
        invoiceData.numeroComprobante && invoiceData.numeroComprobante > 0
          ? invoiceData.numeroComprobante
          : proximoNumero;

      if (numeroAUsar !== proximoNumero) {
        this.logger.warn(
          `El número enviado (${invoiceData.numeroComprobante}) no coincide con el próximo (${proximoNumero}). Usando ${proximoNumero}.`,
        );
        numeroAUsar = proximoNumero;
      }

      // Fecha: AFIP no permite fecha anterior a la del último comprobante
      const fechaCbte = invoiceData.fechaComprobante;
      if (ultimaFecha && fechaCbte < ultimaFecha) {
        throw new BadRequestException(
          `La fecha del comprobante (${fechaCbte}) no puede ser anterior a la del último comprobante autorizado (${ultimaFecha}). ` +
            `AFIP solo permite fechas iguales o posteriores al último comprobante emitido para este punto de venta y tipo de comprobante.`,
        );
      }

      this.logger.log(`Usando número de comprobante: ${numeroAUsar}`);
      this.logger.log(`Usando fecha de comprobante: ${fechaCbte}`);

      // Preparar los datos de la factura para AFIP
      // Para consumidor final (DocTipo = 99), DocNro debe ser 0
      // Para otros tipos de documento, DocNro debe ser > 0
      let docNro: number;
      const docTipoValue = Number(invoiceData.tipoDocumento);
      if (docTipoValue === 99) {
        // Consumidor Final: DocNro siempre es 0
        docNro = 0;
      } else {
        // Otros tipos: parsear el CUIT/DNI del cliente
        docNro =
          invoiceData.cuitCliente === '0'
            ? 0
            : parseInt(invoiceData.cuitCliente.replace(/-/g, ''));
        if (isNaN(docNro) || docNro <= 0) {
          throw new BadRequestException(
            `DocNro inválido para DocTipo ${invoiceData.tipoDocumento}. Debe ser un número válido > 0`,
          );
        }
      }

      // MonId debe ser string: 'PES' (Pesos), 'DOL' (Dólares), etc.
      const monId = invoiceData.monedaId || 'PES';
      const monCotiz = invoiceData.cotizacionMoneda || 1;

      // Determinar la clase de comprobante para validaciones
      const tipoComprobanteValue = Number(invoiceData.tipoComprobante);
      const claseComprobante = getClaseComprobante(tipoComprobanteValue);
      this.logger.log(`Clase de comprobante: ${claseComprobante}`);

      // Condición frente al IVA del receptor
      // Según Manual ARCA-COMPG v4.0 - Obligatorio desde 01/02/2026
      let condicionIva = invoiceData.condicionIvaReceptor;

      // Asignar valor por defecto según clase de comprobante
      if (!condicionIva) {
        switch (claseComprobante) {
          case 'A':
          case 'M':
          case 'FCE_A':
            // Clase A/M: receptor debe ser Responsable Inscripto o Monotributista
            condicionIva = CondicionIvaReceptor.IVA_RESPONSABLE_INSCRIPTO;
            this.logger.log(
              `Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 1 (Responsable Inscripto)`,
            );
            break;
          case 'B':
          case 'FCE_B':
            // Clase B: receptor puede ser Consumidor Final, Exento, etc.
            condicionIva = CondicionIvaReceptor.CONSUMIDOR_FINAL;
            this.logger.log(
              `Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 5 (Consumidor Final)`,
            );
            break;
          case 'C':
          case 'FCE_C':
            // Clase C (Monotributo): receptor puede ser cualquiera
            condicionIva = CondicionIvaReceptor.CONSUMIDOR_FINAL;
            this.logger.log(
              `Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 5 (Consumidor Final)`,
            );
            break;
        }
      } else {
        // Validar que la condición IVA sea válida para la clase de comprobante
        const condicionesValidas = getCondicionesIvaValidas(claseComprobante);
        if (
          condicionesValidas.length > 0 &&
          !condicionesValidas.includes(condicionIva)
        ) {
          this.logger.warn(
            `Condición IVA ${condicionIva} no es válida para clase ${claseComprobante}. Valores válidos: ${condicionesValidas.join(', ')}`,
          );
        }
      }

      this.logger.log(
        `DocTipo: ${invoiceData.tipoDocumento}, DocNro: ${docNro}`,
      );
      this.logger.log(`MonId: ${monId}, MonCotiz: ${monCotiz}`);
      this.logger.log(
        `Concepto: ${invoiceData.concepto} (1=Productos, 2=Servicios, 3=Productos+Servicios)`,
      );
      this.logger.log(`Condición IVA Receptor: ${condicionIva}`);

      // Construir el detalle de la factura
      const detalle: any = {
        Concepto: invoiceData.concepto,
        DocTipo: invoiceData.tipoDocumento,
        DocNro: docNro,
        CbteDesde: numeroAUsar,
        CbteHasta: numeroAUsar,
        CbteFch: fechaCbte,
        ImpTotal: invoiceData.importeTotal,
        ImpTotConc: invoiceData.importeNetoNoGravado || 0,
        ImpNeto: invoiceData.importeNetoGravado,
        ImpOpEx: invoiceData.importeExento || 0,
        ImpIVA: invoiceData.importeIva,
        ImpTrib: invoiceData.importeTributos || 0,
        MonId: monId,
        MonCotiz: monCotiz,
      };

      // Incluir descuento/bonificación si se proporciona
      if (invoiceData.importeDescuento && invoiceData.importeDescuento > 0) {
        detalle.ImpBonif = invoiceData.importeDescuento;
        this.logger.log(
          `Descuento/Bonificación aplicado: ${invoiceData.importeDescuento}`,
        );
      }

      // Incluir condición IVA del receptor (obligatorio desde 01/02/2026)
      if (condicionIva) {
        detalle.IvaCond = condicionIva;
      }

      // Array de IVA - Requerido para Facturas A, B, M cuando hay IVA
      // Según Manual ARCA-COMPG v4.0: debe enviarse el desglose de alícuotas
      if (invoiceData.iva && invoiceData.iva.length > 0) {
        detalle.Iva = {
          AlicIva: invoiceData.iva.map((iva) => ({
            Id: iva.Id,
            BaseImp: iva.BaseImp,
            Importe: iva.Importe,
          })),
        };
        this.logger.log(
          `Array de IVA incluido con ${invoiceData.iva.length} alícuota(s)`,
        );
      } else if (
        invoiceData.importeIva > 0 &&
        (claseComprobante === 'A' ||
          claseComprobante === 'B' ||
          claseComprobante === 'M')
      ) {
        // Si hay IVA pero no se envió el array, crear uno con IVA 21%
        detalle.Iva = {
          AlicIva: [
            {
              Id: 5, // 21%
              BaseImp: invoiceData.importeNetoGravado,
              Importe: invoiceData.importeIva,
            },
          ],
        };
        this.logger.log(
          'Array de IVA generado automáticamente con alícuota 21%',
        );
      }

      // Validación de reglas de NC/ND (N-5, clase match, FCE rules, etc.)
      if (esNotaCreditoDebito(tipoComprobanteValue)) {
        NotaCreditoValidator.validate(invoiceData);
      }

      // Comprobantes asociados - Requerido para Notas de Crédito/Débito
      if (esNotaCreditoDebito(tipoComprobanteValue)) {
        if (
          invoiceData.comprobantesAsociados &&
          invoiceData.comprobantesAsociados.length > 0
        ) {
          detalle.CbtesAsoc = {
            CbteAsoc: invoiceData.comprobantesAsociados.map((cbte) => {
              const asoc: any = {
                Tipo: cbte.Tipo,
                PtoVta: cbte.PtoVta,
                Nro: cbte.Nro,
                CbteFch: cbte.CbteFch,
              };
              if (cbte.Cuit) {
                asoc.Cuit = cbte.Cuit.replace(/-/g, '');
              }
              return asoc;
            }),
          };
          this.logger.log(
            `Comprobantes asociados incluidos: ${invoiceData.comprobantesAsociados.length}`,
          );
        }

        // Período asociado (alternativa a CbteAsoc para NC/ND que ajustan un rango)
        if (invoiceData.periodoAsociado) {
          detalle.PeriodoAsoc = {
            FchDesde: invoiceData.periodoAsociado.FchDesde,
            FchHasta: invoiceData.periodoAsociado.FchHasta,
          };
          this.logger.log(
            `Período asociado: ${invoiceData.periodoAsociado.FchDesde} - ${invoiceData.periodoAsociado.FchHasta}`,
          );
        }
      }

      // Opcionales genéricos (el user puede mandar cualquier opcional)
      // + auto-inyección del opcional 22 según esAnulacion
      const opcionalesAcum: Array<{ Id: number; Valor: string }> = [];
      if (invoiceData.opcionales && invoiceData.opcionales.length > 0) {
        for (const o of invoiceData.opcionales) {
          opcionalesAcum.push({ Id: o.Id, Valor: o.Valor });
        }
      }
      if (
        esNotaCreditoDebito(tipoComprobanteValue) &&
        invoiceData.esAnulacion !== undefined
      ) {
        const yaTiene22 = opcionalesAcum.some((o) => o.Id === 22);
        if (!yaTiene22) {
          opcionalesAcum.push({
            Id: 22,
            Valor: invoiceData.esAnulacion ? 'S' : 'N',
          });
          this.logger.log(
            `Opcional 22 auto-inyectado: Valor=${invoiceData.esAnulacion ? 'S' : 'N'}`,
          );
        }
      }

      // Campos para Facturas de Crédito Electrónica (MiPyME)
      if (esFacturaCreditoElectronica(tipoComprobanteValue)) {
        if (invoiceData.cbu) {
          opcionalesAcum.push({ Id: 2101, Valor: invoiceData.cbu.Cbu });
          if (invoiceData.cbu.Alias) {
            opcionalesAcum.push({ Id: 2102, Valor: invoiceData.cbu.Alias });
          }
          this.logger.log('Datos de CBU incluidos para FCE');
        }
        if (invoiceData.fceVtoPago) {
          detalle.FchVtoPago = invoiceData.fceVtoPago;
          this.logger.log(`Fecha vencimiento FCE: ${invoiceData.fceVtoPago}`);
        }
      }

      // Set Opcionales final al detalle si hay alguno
      if (opcionalesAcum.length > 0) {
        detalle.Opcionales = { Opcional: opcionalesAcum };
      }

      // Fechas de servicio - Solo para Concepto 2 (Servicios) o 3 (Productos + Servicios)
      if (invoiceData.concepto === 2 || invoiceData.concepto === 3) {
        detalle.FchServDesde = invoiceData.fechaServicioDesde || fechaCbte;
        detalle.FchServHasta = invoiceData.fechaServicioHasta || fechaCbte;
        detalle.FchVtoPago = invoiceData.fechaVencimientoPago || fechaCbte;
        this.logger.log('Incluyendo fechas de servicio (Concepto 2 o 3)');
      } else {
        this.logger.log(
          'Omitiendo fechas de servicio (Concepto 1 - Productos)',
        );
      }

      const fecaeReq = {
        Auth: {
          Token: authTicket.token,
          Sign: authTicket.sign,
          Cuit: cuitEmisor,
        },
        FeCAEReq: {
          FeCabReq: {
            CantReg: 1,
            PtoVta: invoiceData.puntoVenta,
            CbteTipo: invoiceData.tipoComprobante,
          },
          FeDetReq: {
            FECAEDetRequest: detalle,
          },
        },
      };

      this.logger.log('=== PAYLOAD ENVIADO A AFIP ===');
      this.logger.log(JSON.stringify(fecaeReq, null, 2));

      // Crear cliente SOAP para WSFE
      return new Promise((resolve, reject) => {
        soap.createClient(wsfeUrl, async (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSFE: ${err.message}`,
            );
            this.logger.error(`Stack: ${err.stack}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSFE: ${err.message}`,
              ),
            );
            return;
          }

          this.logger.log('Cliente SOAP WSFE creado correctamente');

          // Llamar al método FECAESolicitar del servicio WSFE
          client.FECAESolicitar(fecaeReq, async (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error al llamar FECAESolicitar: ${err.message}`,
              );
              this.logger.error(
                `Error completo: ${JSON.stringify(err, null, 2)}`,
              );
              reject(
                new BadRequestException(
                  `Error al crear factura: ${err.message}`,
                ),
              );
              return;
            }

            try {
              this.logger.log('=== RESPUESTA COMPLETA DE AFIP ===');
              this.logger.log(JSON.stringify(result, null, 2));

              const response = result.FECAESolicitarResult;

              // Log de la respuesta completa
              this.logger.log('=== FECAESolicitarResult ===');
              this.logger.log(JSON.stringify(response, null, 2));

              // Verificar errores en la cabecera (estructura: Errors.Err[])
              // No rechazar aquí, dejar que se procesen junto con las observaciones del detalle
              if (response.Errors) {
                const errArray = response.Errors.Err
                  ? Array.isArray(response.Errors.Err)
                    ? response.Errors.Err
                    : [response.Errors.Err]
                  : Array.isArray(response.Errors)
                    ? response.Errors
                    : [];

                if (errArray.length > 0) {
                  this.logger.error(
                    '=== ERRORES CRÍTICOS DE AFIP (Cabecera) ===',
                  );
                  errArray.forEach((error: any, index: number) => {
                    const code = error.Code || error.code || 'N/A';
                    const msg =
                      error.Msg ||
                      error.msg ||
                      error.message ||
                      JSON.stringify(error);
                    this.logger.error(
                      `Error ${index + 1}: Code=${code}, Msg=${msg}`,
                    );
                  });
                }
              }

              // Verificar que existe FeDetResp
              if (!response.FeDetResp) {
                this.logger.error('No se encontró FeDetResp en la respuesta');
                reject(
                  new BadRequestException(
                    'No se recibió respuesta válida de AFIP (sin FeDetResp)',
                  ),
                );
                return;
              }

              // Obtener la factura (puede ser array o objeto único)
              const factura =
                response.FeDetResp.FECAEDetResponse?.[0] ||
                response.FeDetResp.FECAEDetResponse;

              if (!factura) {
                this.logger.error(
                  'No se encontró FECAEDetResponse en la respuesta',
                );
                this.logger.error(
                  `FeDetResp completo: ${JSON.stringify(response.FeDetResp, null, 2)}`,
                );
                reject(
                  new BadRequestException(
                    'No se recibió respuesta válida de AFIP (sin FECAEDetResponse)',
                  ),
                );
                return;
              }

              this.logger.log('=== DETALLE DE LA FACTURA ===');
              this.logger.log(JSON.stringify(factura, null, 2));

              // Extraer errores y observaciones (pueden estar en diferentes formatos)
              // AFIP puede enviar:
              // 1. Errors.Err[] a nivel de respuesta (errores críticos)
              // 2. Observaciones.Obs[] en el detalle (observaciones/advertencias)
              let observaciones: string[] = [];
              let observacionesDetalladas: Array<{
                code: number;
                msg: string;
              }> = [];

              // Primero, parsear errores críticos de la respuesta completa
              if (response.Errors && response.Errors.Err) {
                const errArray = Array.isArray(response.Errors.Err)
                  ? response.Errors.Err
                  : [response.Errors.Err];

                errArray.forEach((err: any) => {
                  if (err.Code && err.Msg) {
                    const code = Number(err.Code);
                    const msg = err.Msg;
                    observacionesDetalladas.push({ code, msg });
                    observaciones.push(`${code}: ${msg}`);
                    this.logger.error(`[ERROR CRÍTICO ${code}] ${msg}`);
                  } else if (err.Msg) {
                    observaciones.push(err.Msg);
                    this.logger.error(`[ERROR] ${err.Msg}`);
                  }
                });
              }

              // Luego, parsear observaciones del detalle de la factura
              if (factura.Observaciones) {
                // Formato: Observaciones.Obs[] con objetos {Code, Msg}
                if (factura.Observaciones.Obs) {
                  const obsArray = Array.isArray(factura.Observaciones.Obs)
                    ? factura.Observaciones.Obs
                    : [factura.Observaciones.Obs];

                  obsArray.forEach((obs: any) => {
                    if (obs.Code && obs.Msg) {
                      const code = Number(obs.Code);
                      const msg = obs.Msg;
                      observacionesDetalladas.push({ code, msg });
                      observaciones.push(`${code}: ${msg}`);
                    } else if (obs.Msg) {
                      observaciones.push(obs.Msg);
                    } else if (typeof obs === 'string') {
                      observaciones.push(obs);
                    }
                  });
                }
                // Formato: Observaciones como array directo
                else if (Array.isArray(factura.Observaciones)) {
                  factura.Observaciones.forEach((obs: any) => {
                    if (obs.Code && obs.Msg) {
                      const code = Number(obs.Code);
                      const msg = obs.Msg;
                      observacionesDetalladas.push({ code, msg });
                      observaciones.push(`${code}: ${msg}`);
                    } else if (obs.Msg) {
                      observaciones.push(obs.Msg);
                    } else if (typeof obs === 'string') {
                      observaciones.push(obs);
                    } else {
                      observaciones.push(JSON.stringify(obs));
                    }
                  });
                }
                // Formato: Observaciones como objeto simple
                else if (factura.Observaciones.Msg) {
                  observaciones.push(factura.Observaciones.Msg);
                } else if (typeof factura.Observaciones === 'string') {
                  observaciones.push(factura.Observaciones);
                }
              }

              const resultado = factura.Resultado || '';
              this.logger.log(`Resultado: ${resultado}`);
              this.logger.log(`CAE: ${factura.CAE || '(vacío)'}`);
              this.logger.log(`CAE Fch Vto: ${factura.CAEFchVto || '(vacío)'}`);

              // Loggear todos los errores y observaciones
              if (observacionesDetalladas.length > 0) {
                this.logger.error('=== ERRORES Y OBSERVACIONES DE AFIP ===');
                observacionesDetalladas.forEach((obs, index) => {
                  this.logger.error(`[${obs.code}] ${obs.msg}`);
                });
              }
              if (
                observaciones.length > 0 &&
                observacionesDetalladas.length === 0
              ) {
                this.logger.warn('=== OBSERVACIONES DE AFIP ===');
                observaciones.forEach((obs, index) => {
                  this.logger.warn(`Observación ${index + 1}: ${obs}`);
                });
              }

              // Si el resultado es "R" (Rechazado), loggear y lanzar error con detalles
              if (resultado === 'R') {
                this.logger.error(`=== FACTURA RECHAZADA (R) ===`);

                // Construir mensaje de error más claro
                let errorMessage = 'Factura rechazada por AFIP';

                if (observacionesDetalladas.length > 0) {
                  const erroresFormateados = observacionesDetalladas.map(
                    (obs) => `[${obs.code}] ${obs.msg}`,
                  );
                  errorMessage += ':\n' + erroresFormateados.join('\n');
                } else if (observaciones.length > 0) {
                  errorMessage += ':\n' + observaciones.join('\n');
                } else {
                  errorMessage += ' sin observaciones específicas';
                }

                this.logger.error(errorMessage);

                // Crear excepción con mensaje estructurado
                const exception = new BadRequestException(errorMessage);
                // Agregar información adicional al exception para que el interceptor pueda usarla
                (exception as any).observaciones =
                  observacionesDetalladas.length > 0
                    ? observacionesDetalladas
                    : observaciones.map((msg) => ({ code: 0, msg }));

                reject(exception);
                return;
              }

              // Si el resultado es "P" (Parcialmente aprobado) o "A" (Aprobado)
              if (resultado === 'A' || resultado === 'P') {
                this.logger.log(
                  `=== FACTURA ${resultado === 'A' ? 'APROBADA' : 'PARCIALMENTE APROBADA'} ===`,
                );
                this.logger.log(`CAE: ${factura.CAE}`);
                this.logger.log(
                  `Número de comprobante: ${factura.CbteDesde || invoiceData.numeroComprobante}`,
                );
              }

              // Generar datos para el código QR (RG 4291)
              let qrData: QrDataDto | undefined;
              if (factura.CAE && resultado === 'A') {
                qrData = this.generateQrData({
                  cuit: cuitEmisor,
                  ptoVta: invoiceData.puntoVenta,
                  tipoCmp: tipoComprobanteValue,
                  nroCmp: factura.CbteDesde || numeroAUsar,
                  fecha: fechaCbte,
                  importe: invoiceData.importeTotal,
                  moneda: monId,
                  ctz: monCotiz,
                  tipoDocRec: docTipoValue,
                  nroDocRec: docNro,
                  codAut: factura.CAE,
                });
                this.logger.log(`QR URL generada: ${qrData.url}`);
              }

              const invoiceResponse: InvoiceResponseDto = {
                cae: factura.CAE || '',
                caeFchVto: factura.CAEFchVto || '',
                puntoVenta: invoiceData.puntoVenta,
                tipoComprobante: tipoComprobanteValue,
                numeroComprobante: factura.CbteDesde || numeroAUsar,
                fechaComprobante: fechaCbte,
                importeTotal: invoiceData.importeTotal,
                resultado: resultado,
                codigoAutorizacion: factura.CAE,
                cuitEmisor: cuitEmisor,
                tipoDocReceptor: docTipoValue,
                nroDocReceptor: String(docNro),
                observaciones:
                  observaciones.length > 0 ? observaciones : undefined,
                ...(observacionesDetalladas.length > 0 && {
                  observacionesDetalladas,
                }),
                ...(qrData && { qrData }),
              };

              this.logger.log('=== RESPUESTA FINAL ===');
              this.logger.log(JSON.stringify(invoiceResponse, null, 2));
              this.logger.log('=== FIN CREACIÓN DE FACTURA ===');

              resolve(invoiceResponse);
            } catch (parseError: any) {
              this.logger.error(
                `Error al procesar respuesta: ${parseError.message}`,
              );
              this.logger.error(`Stack: ${parseError.stack}`);
              reject(
                new BadRequestException(
                  `Error al procesar respuesta: ${parseError.message}`,
                ),
              );
            }
          });
        });
      });
    } catch (error: any) {
      this.logger.error(`Error general al crear factura: ${error.message}`);
      this.logger.error(`Stack: ${error.stack}`);
      throw new BadRequestException(
        `Error al crear factura electrónica: ${error.message}`,
      );
    }
  }

  /**
   * Genera los datos para el código QR según especificación AFIP RG 4291
   * https://www.afip.gob.ar/fe/qr/especificaciones.asp
   *
   * El QR contiene información del comprobante codificada en base64 y se accede
   * mediante la URL: https://www.afip.gob.ar/fe/qr/?p={datos_base64}
   */
  private generateQrData(params: {
    cuit: string;
    ptoVta: number;
    tipoCmp: number;
    nroCmp: number;
    fecha: string; // YYYYMMDD
    importe: number;
    moneda: string;
    ctz: number;
    tipoDocRec: number;
    nroDocRec: number;
    codAut: string;
  }): QrDataDto {
    // Formatear la fecha de YYYYMMDD a YYYY-MM-DD
    const fechaFormateada = `${params.fecha.substring(0, 4)}-${params.fecha.substring(4, 6)}-${params.fecha.substring(6, 8)}`;

    // Estructura JSON según especificación AFIP
    const qrJson = {
      ver: 1,
      fecha: fechaFormateada,
      cuit: parseInt(params.cuit),
      ptoVta: params.ptoVta,
      tipoCmp: params.tipoCmp,
      nroCmp: params.nroCmp,
      importe: params.importe,
      moneda: params.moneda,
      ctz: params.ctz,
      tipoDocRec: params.tipoDocRec,
      nroDocRec: params.nroDocRec,
      tipoCodAut: 'E', // E = CAE, A = CAEA
      codAut: parseInt(params.codAut),
    };

    // Codificar en base64 y generar URL
    const jsonString = JSON.stringify(qrJson);
    const base64Data = Buffer.from(jsonString).toString('base64');
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${base64Data}`;

    return {
      ver: 1,
      fecha: fechaFormateada,
      cuit: params.cuit,
      ptoVta: params.ptoVta,
      tipoCmp: params.tipoCmp,
      nroCmp: params.nroCmp,
      importe: params.importe,
      moneda: params.moneda,
      ctz: params.ctz,
      tipoDocRec: params.tipoDocRec,
      nroDocRec: String(params.nroDocRec),
      tipoCodAut: 'E',
      codAut: params.codAut,
      url: qrUrl,
    };
  }

  /**
   * Obtiene los tipos de comprobante disponibles para el emisor
   */
  async getTiposComprobante(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<
    Array<{ Id: number; Desc: string; FchDesde: string; FchHasta: string }>
  > {
    const ticket = await this.getTicket(
      'wsfe',
      certificado,
      clavePrivada,
      homologacion,
    );
    const urls = this.getAfipUrls(homologacion);
    const wsfeUrl = urls.wsfe;

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(
            new BadRequestException(
              `Error al crear cliente SOAP: ${err.message}`,
            ),
          );
          return;
        }

        const request = {
          Auth: {
            Token: ticket.token,
            Sign: ticket.sign,
            Cuit: cuitEmisor.replace(/-/g, ''),
          },
        };

        client.FEParamGetTiposCbte(request, (err: any, result: any) => {
          if (err) {
            reject(
              new BadRequestException(
                `Error al obtener tipos de comprobante: ${err.message}`,
              ),
            );
            return;
          }

          const tipos =
            result.FEParamGetTiposCbteResult?.ResultGet?.CbteTipo || [];
          const tiposArray = Array.isArray(tipos) ? tipos : [tipos];
          resolve(tiposArray);
        });
      });
    });
  }

  /**
   * Obtiene los puntos de venta habilitados para el emisor
   */
  async getPuntosVenta(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<
    Array<{
      Nro: number;
      EmisionTipo: string;
      Bloqueado: string;
      FchBaja: string;
    }>
  > {
    const ticket = await this.getTicket(
      'wsfe',
      certificado,
      clavePrivada,
      homologacion,
    );
    const urls = this.getAfipUrls(homologacion);
    const wsfeUrl = urls.wsfe;

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(
            new BadRequestException(
              `Error al crear cliente SOAP: ${err.message}`,
            ),
          );
          return;
        }

        const request = {
          Auth: {
            Token: ticket.token,
            Sign: ticket.sign,
            Cuit: cuitEmisor.replace(/-/g, ''),
          },
        };

        client.FEParamGetPtosVenta(request, (err: any, result: any) => {
          if (err) {
            reject(
              new BadRequestException(
                `Error al obtener puntos de venta: ${err.message}`,
              ),
            );
            return;
          }

          const ptos =
            result.FEParamGetPtosVentaResult?.ResultGet?.PtoVenta || [];
          const ptosArray = Array.isArray(ptos) ? ptos : [ptos];
          resolve(ptosArray);
        });
      });
    });
  }

  /**
   * Obtiene las condiciones de IVA válidas para el receptor según la clase de comprobante
   */
  async getCondicionesIvaReceptor(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    claseComprobante?: string, // A, B, C, M
    homologacion: boolean = false,
  ): Promise<Array<{ Id: number; Desc: string; Cmp_Clase: string }>> {
    const ticket = await this.getTicket(
      'wsfe',
      certificado,
      clavePrivada,
      homologacion,
    );
    const urls = this.getAfipUrls(homologacion);
    const wsfeUrl = urls.wsfe;

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(
            new BadRequestException(
              `Error al crear cliente SOAP: ${err.message}`,
            ),
          );
          return;
        }

        const request: any = {
          Auth: {
            Token: ticket.token,
            Sign: ticket.sign,
            Cuit: cuitEmisor.replace(/-/g, ''),
          },
        };

        if (claseComprobante) {
          request.ClaseCmp = claseComprobante;
        }

        client.FEParamGetCondicionIvaReceptor(
          request,
          (err: any, result: any) => {
            if (err) {
              reject(
                new BadRequestException(
                  `Error al obtener condiciones IVA: ${err.message}`,
                ),
              );
              return;
            }

            const condiciones =
              result.FEParamGetCondicionIvaReceptorResult?.ResultGet
                ?.CondicionIvaReceptor || [];
            const condicionesArray = Array.isArray(condiciones)
              ? condiciones
              : [condiciones];
            resolve(condicionesArray);
          },
        );
      });
    });
  }

  // ============================================
  // VENTANILLA ELECTRÓNICA (VE) SERVICE METHODS
  // ============================================

  /**
   * Consulta las comunicaciones de la Ventanilla Electrónica de AFIP
   *
   * @param cuitRepresentada - CUIT del contribuyente
   * @param certificado - Certificado en formato PEM
   * @param clavePrivada - Clave privada en formato PEM
   * @param filtros - Filtros opcionales (estado, fechas, sistema publicador)
   * @param pagina - Número de página (1-based)
   * @param itemsPorPagina - Items por página (máx 50)
   *
   * @returns Comunicaciones paginadas
   */
  async consultarComunicaciones(
    cuitRepresentada: string,
    certificado: string,
    clavePrivada: string,
    filtros?: {
      estado?: number;
      fechaDesde?: string;
      fechaHasta?: string;
      idSistemaPublicador?: number;
      idComunicacionDesde?: number;
      idComunicacionHasta?: number;
    },
    pagina: number = 1,
    itemsPorPagina: number = 20,
    homologacion: boolean = false,
  ): Promise<{
    paginacion: {
      pagina: number;
      totalPaginas: number;
      itemsPorPagina: number;
      totalItems: number;
    };
    comunicaciones: Array<{
      idComunicacion: number;
      cuitDestinatario: string;
      fechaPublicacion: string;
      fechaVencimiento?: string;
      sistemaPublicador: number;
      sistemaPublicadorDesc: string;
      estado: number;
      estadoDesc: string;
      asunto: string;
      prioridad?: number;
      tieneAdjunto: boolean;
      referencia1?: string;
      referencia2?: string;
    }>;
  }> {
    this.logger.log(
      '=== CONSULTANDO COMUNICACIONES VENTANILLA ELECTRÓNICA ===',
    );
    this.logger.log(`CUIT Representada: ${cuitRepresentada}`);
    this.logger.log(`Página: ${pagina}, Items por página: ${itemsPorPagina}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);
    if (filtros) {
      this.logger.log(`Filtros: ${JSON.stringify(filtros)}`);
    }

    // Obtener ticket para el servicio veconsumerws
    const ticket = await this.getTicket(
      'veconsumerws',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const ventanillaUrl = urls.ventanilla;

    return new Promise((resolve, reject) => {
      soap.createClient(
        ventanillaUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP VE: ${err.message}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP Ventanilla Electrónica: ${err.message}`,
              ),
            );
            return;
          }

          // Construir el request según la especificación del PDF
          const request: any = {
            authRequest: {
              token: ticket.token,
              sign: ticket.sign,
              cuitRepresentada: cuitRepresentada.replace(/-/g, ''),
            },
            pagina: pagina,
            itemsPorPagina: itemsPorPagina,
          };

          // Agregar filtros si existen
          if (filtros) {
            request.filter = {};

            if (filtros.estado !== undefined) {
              request.filter.estado = filtros.estado;
            }
            if (filtros.fechaDesde) {
              // Formato esperado: yyyy-MM-dd
              request.filter.fechaDesde = filtros.fechaDesde;
            }
            if (filtros.fechaHasta) {
              request.filter.fechaHasta = filtros.fechaHasta;
            }
            if (filtros.idSistemaPublicador !== undefined) {
              request.filter.idSistemaPublicador = filtros.idSistemaPublicador;
            }
            if (filtros.idComunicacionDesde !== undefined) {
              request.filter.idComunicacionDesde = filtros.idComunicacionDesde;
            }
            if (filtros.idComunicacionHasta !== undefined) {
              request.filter.idComunicacionHasta = filtros.idComunicacionHasta;
            }
          }

          this.logger.log('Request a VE: ' + JSON.stringify(request, null, 2));

          client.consultarComunicaciones(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en consultarComunicaciones: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al consultar comunicaciones: ${err.message}`,
                ),
              );
              return;
            }

            try {
              this.logger.log('Respuesta recibida de VE');

              // Parsear respuesta según estructura del PDF
              const respuestaPaginada =
                result?.consultarComunicacionesResponse?.RespuestaPaginada ||
                result?.RespuestaPaginada ||
                result;

              const items =
                respuestaPaginada?.items?.item ||
                respuestaPaginada?.items ||
                [];
              const comunicacionesArray = Array.isArray(items)
                ? items
                : items
                  ? [items]
                  : [];

              // Mapear las comunicaciones al formato de respuesta
              const comunicaciones = comunicacionesArray.map((c: any) => ({
                idComunicacion: Number(c.idComunicacion || c.id),
                cuitDestinatario: String(
                  c.cuitDestinatario || cuitRepresentada,
                ),
                fechaPublicacion: c.fechaPublicacion || '',
                fechaVencimiento: c.fechaVencimiento || undefined,
                sistemaPublicador: Number(
                  c.sistemaPublicador || c.idSistemaPublicador || 0,
                ),
                sistemaPublicadorDesc:
                  c.sistemaPublicadorDesc || c.descSistemaPublicador || '',
                estado: Number(c.estado || 1),
                estadoDesc:
                  c.estadoDesc ||
                  this.getEstadoDescripcion(Number(c.estado || 1)),
                asunto: c.asunto || '',
                prioridad: c.prioridad ? Number(c.prioridad) : undefined,
                tieneAdjunto:
                  c.tieneAdjunto === true ||
                  c.tieneAdjunto === 'true' ||
                  c.tieneAdjunto === 1,
                referencia1: c.referencia1 || undefined,
                referencia2: c.referencia2 || undefined,
              }));

              const response = {
                paginacion: {
                  pagina: Number(respuestaPaginada?.pagina || pagina),
                  totalPaginas: Number(respuestaPaginada?.totalPaginas || 1),
                  itemsPorPagina: Number(
                    respuestaPaginada?.itemsPorPagina || itemsPorPagina,
                  ),
                  totalItems: Number(
                    respuestaPaginada?.totalItems || comunicaciones.length,
                  ),
                },
                comunicaciones,
              };

              this.logger.log(
                `Comunicaciones encontradas: ${response.paginacion.totalItems}`,
              );
              resolve(response);
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear respuesta VE: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar respuesta de Ventanilla Electrónica: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Consume/lee una comunicación específica de la Ventanilla Electrónica
   *
   * @param cuitRepresentada - CUIT del contribuyente
   * @param certificado - Certificado en formato PEM
   * @param clavePrivada - Clave privada en formato PEM
   * @param idComunicacion - ID de la comunicación a leer
   * @param incluirAdjuntos - Si se incluyen los adjuntos en base64
   *
   * @returns Detalle de la comunicación
   */
  async consumirComunicacion(
    cuitRepresentada: string,
    certificado: string,
    clavePrivada: string,
    idComunicacion: number,
    incluirAdjuntos: boolean = false,
    homologacion: boolean = false,
  ): Promise<{
    idComunicacion: number;
    cuitDestinatario: string;
    fechaPublicacion: string;
    fechaVencimiento?: string;
    sistemaPublicador: number;
    sistemaPublicadorDesc: string;
    estado: number;
    estadoDesc: string;
    asunto: string;
    prioridad?: number;
    tieneAdjunto: boolean;
    referencia1?: string;
    referencia2?: string;
    cuerpo?: string;
    adjuntos?: Array<{
      nombre: string;
      tipoMime: string;
      contenidoBase64?: string;
      tamanio?: number;
    }>;
    fechaLectura?: string;
  }> {
    this.logger.log('=== CONSUMIENDO COMUNICACIÓN VENTANILLA ELECTRÓNICA ===');
    this.logger.log(`CUIT Representada: ${cuitRepresentada}`);
    this.logger.log(`ID Comunicación: ${idComunicacion}`);
    this.logger.log(`Incluir Adjuntos: ${incluirAdjuntos}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'veconsumerws',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const ventanillaUrl = urls.ventanilla;

    return new Promise((resolve, reject) => {
      soap.createClient(
        ventanillaUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP VE: ${err.message}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP Ventanilla Electrónica: ${err.message}`,
              ),
            );
            return;
          }

          const request: any = {
            authRequest: {
              token: ticket.token,
              sign: ticket.sign,
              cuitRepresentada: cuitRepresentada.replace(/-/g, ''),
            },
            idComunicacion: idComunicacion,
          };

          this.logger.log(
            'Request a VE consumirComunicacion: ' +
              JSON.stringify(request, null, 2),
          );

          client.consumirComunicacion(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en consumirComunicacion: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al consumir comunicación: ${err.message}`,
                ),
              );
              return;
            }

            try {
              this.logger.log(
                'Respuesta recibida de VE (consumirComunicacion)',
              );

              const comunicacion =
                result?.consumirComunicacionResponse?.Comunicacion ||
                result?.Comunicacion ||
                result;

              // Parsear adjuntos si existen
              let adjuntos: any[] = [];
              if (comunicacion.adjuntos?.adjunto) {
                const adjuntosData = Array.isArray(
                  comunicacion.adjuntos.adjunto,
                )
                  ? comunicacion.adjuntos.adjunto
                  : [comunicacion.adjuntos.adjunto];

                adjuntos = adjuntosData.map((adj: any) => ({
                  nombre: adj.nombre || adj.fileName || '',
                  tipoMime:
                    adj.tipoMime || adj.mimeType || 'application/octet-stream',
                  contenidoBase64: incluirAdjuntos
                    ? adj.contenido || adj.content || ''
                    : undefined,
                  tamanio: adj.tamanio ? Number(adj.tamanio) : undefined,
                }));
              }

              const response = {
                idComunicacion: Number(
                  comunicacion.idComunicacion ||
                    comunicacion.id ||
                    idComunicacion,
                ),
                cuitDestinatario: String(
                  comunicacion.cuitDestinatario || cuitRepresentada,
                ),
                fechaPublicacion: comunicacion.fechaPublicacion || '',
                fechaVencimiento: comunicacion.fechaVencimiento || undefined,
                sistemaPublicador: Number(
                  comunicacion.sistemaPublicador ||
                    comunicacion.idSistemaPublicador ||
                    0,
                ),
                sistemaPublicadorDesc:
                  comunicacion.sistemaPublicadorDesc ||
                  comunicacion.descSistemaPublicador ||
                  '',
                estado: Number(comunicacion.estado || 2), // 2 = Leída (ya que la estamos consumiendo)
                estadoDesc:
                  comunicacion.estadoDesc ||
                  this.getEstadoDescripcion(Number(comunicacion.estado || 2)),
                asunto: comunicacion.asunto || '',
                prioridad: comunicacion.prioridad
                  ? Number(comunicacion.prioridad)
                  : undefined,
                tieneAdjunto:
                  adjuntos.length > 0 || comunicacion.tieneAdjunto === true,
                referencia1: comunicacion.referencia1 || undefined,
                referencia2: comunicacion.referencia2 || undefined,
                cuerpo:
                  comunicacion.cuerpo ||
                  comunicacion.mensaje ||
                  comunicacion.body ||
                  '',
                adjuntos: adjuntos.length > 0 ? adjuntos : undefined,
                fechaLectura:
                  comunicacion.fechaLectura || new Date().toISOString(),
              };

              this.logger.log(
                `Comunicación leída exitosamente: ${response.idComunicacion}`,
              );
              resolve(response);
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear comunicación: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar comunicación: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Consulta los sistemas publicadores disponibles en Ventanilla Electrónica
   */
  async consultarSistemasPublicadores(
    cuitRepresentada: string,
    certificado: string,
    clavePrivada: string,
    idSistemaPublicador?: number,
    homologacion: boolean = false,
  ): Promise<
    Array<{
      id: number;
      descripcion: string;
      certCN?: string;
      subservicios?: string[];
    }>
  > {
    this.logger.log('=== CONSULTANDO SISTEMAS PUBLICADORES VE ===');
    this.logger.log(`CUIT Representada: ${cuitRepresentada}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'veconsumerws',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const ventanillaUrl = urls.ventanilla;

    return new Promise((resolve, reject) => {
      soap.createClient(
        ventanillaUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP VE: ${err.message}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP VE: ${err.message}`,
              ),
            );
            return;
          }

          const request: any = {
            authRequest: {
              token: ticket.token,
              sign: ticket.sign,
              cuitRepresentada: cuitRepresentada.replace(/-/g, ''),
            },
          };

          if (idSistemaPublicador !== undefined) {
            request.idSistemaPublicador = idSistemaPublicador;
          }

          client.consultarSistemasPublicadores(
            request,
            (err: any, result: any) => {
              if (err) {
                this.logger.error(
                  `Error en consultarSistemasPublicadores: ${err.message}`,
                );
                reject(
                  new BadRequestException(
                    `Error al consultar sistemas publicadores: ${err.message}`,
                  ),
                );
                return;
              }

              try {
                const sistemas =
                  result?.consultarSistemasPublicadoresResponse?.Sistemas
                    ?.Sistema ||
                  result?.Sistemas?.Sistema ||
                  [];
                const sistemasArray = Array.isArray(sistemas)
                  ? sistemas
                  : sistemas
                    ? [sistemas]
                    : [];

                const response = sistemasArray.map((s: any) => ({
                  id: Number(s.id),
                  descripcion: s.descripcion || '',
                  certCN: s.certCN || undefined,
                  subservicios: s.subservicios?.subservicio || undefined,
                }));

                this.logger.log(
                  `Sistemas publicadores encontrados: ${response.length}`,
                );
                resolve(response);
              } catch (parseError: any) {
                this.logger.error(
                  `Error al parsear sistemas publicadores: ${parseError.message}`,
                );
                reject(
                  new BadRequestException(
                    `Error al procesar sistemas publicadores: ${parseError.message}`,
                  ),
                );
              }
            },
          );
        },
      );
    });
  }

  /**
   * Consulta los estados disponibles para comunicaciones
   */
  async consultarEstadosComunicacion(
    cuitRepresentada: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<
    Array<{
      codigo: number;
      descripcion: string;
    }>
  > {
    this.logger.log('=== CONSULTANDO ESTADOS DE COMUNICACIÓN VE ===');
    this.logger.log(`CUIT Representada: ${cuitRepresentada}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'veconsumerws',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const ventanillaUrl = urls.ventanilla;

    return new Promise((resolve, reject) => {
      soap.createClient(
        ventanillaUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP VE: ${err.message}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP VE: ${err.message}`,
              ),
            );
            return;
          }

          const request = {
            authRequest: {
              token: ticket.token,
              sign: ticket.sign,
              cuitRepresentada: cuitRepresentada.replace(/-/g, ''),
            },
          };

          client.consultarEstados(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(`Error en consultarEstados: ${err.message}`);
              reject(
                new BadRequestException(
                  `Error al consultar estados: ${err.message}`,
                ),
              );
              return;
            }

            try {
              const estados =
                result?.consultarEstadosResponse?.Estados?.Estado ||
                result?.Estados?.Estado ||
                [];
              const estadosArray = Array.isArray(estados)
                ? estados
                : estados
                  ? [estados]
                  : [];

              const response = estadosArray.map((e: any) => ({
                codigo: Number(e.id || e.codigo),
                descripcion: e.descripcion || '',
              }));

              // Si no hay estados del servicio, devolver los estándar
              if (response.length === 0) {
                resolve([
                  { codigo: 1, descripcion: 'No leída' },
                  { codigo: 2, descripcion: 'Leída' },
                ]);
                return;
              }

              this.logger.log(`Estados encontrados: ${response.length}`);
              resolve(response);
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear estados: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar estados: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Helper para obtener descripción de estado
   */
  private getEstadoDescripcion(estado: number): string {
    const estados: { [key: number]: string } = {
      1: 'No leída',
      2: 'Leída',
    };
    return estados[estado] || `Estado ${estado}`;
  }

  // ============================================
  // WSCDC (CONSTATACIÓN DE COMPROBANTES) METHODS
  // ============================================

  /**
   * Constata/verifica un comprobante específico
   *
   * @param cuitEmisor - CUIT del emisor
   * @param certificado - Certificado en formato PEM
   * @param clavePrivada - Clave privada en formato PEM
   * @param puntoVenta - Punto de venta
   * @param tipoComprobante - Tipo de comprobante
   * @param numeroComprobante - Número de comprobante
   * @param cuitEmisorComprobante - CUIT del emisor del comprobante (opcional, para verificar comprobantes de terceros)
   *
   * @returns Resultado de la constatación
   */
  async constatarComprobante(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    puntoVenta: number,
    tipoComprobante: number,
    numeroComprobante: number,
    cuitEmisorComprobante?: string,
    homologacion: boolean = false,
  ): Promise<{
    resultado: string;
    codigoAutorizacion?: string;
    fechaEmision?: string;
    fechaVencimiento?: string;
    importeTotal?: number;
    estado?: string;
    puntoVenta: number;
    tipoComprobante: number;
    numeroComprobante: number;
    cuitEmisor: string;
    cuitReceptor?: string;
    errors?: Array<{ code: number; msg: string }>;
    events?: Array<{ code: number; msg: string }>;
  }> {
    this.logger.log('=== CONSTATANDO COMPROBANTE WSCDC ===');
    this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
    this.logger.log(
      `Punto Venta: ${puntoVenta}, Tipo: ${tipoComprobante}, Nro: ${numeroComprobante}`,
    );
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);
    if (cuitEmisorComprobante) {
      this.logger.log(`CUIT Emisor Comprobante: ${cuitEmisorComprobante}`);
    }

    const ticket = await this.getTicket(
      'wscdc',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          const request: any = {
            auth: {
              token: ticket.token,
              sign: ticket.sign,
              cuit: cuitEmisor.replace(/-/g, ''),
            },
            puntoVenta: puntoVenta,
            tipoComprobante: tipoComprobante,
            numeroComprobante: numeroComprobante,
          };

          if (cuitEmisorComprobante) {
            request.cuitEmisorComprobante = cuitEmisorComprobante.replace(
              /-/g,
              '',
            );
          }

          this.logger.log(
            'Request a WSCDC ComprobanteConstatar: ' +
              JSON.stringify(request, null, 2),
          );

          client.ComprobanteConstatar(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en ComprobanteConstatar: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al constatar comprobante: ${err.message}`,
                ),
              );
              return;
            }

            try {
              this.logger.log(
                'Respuesta recibida de WSCDC (ComprobanteConstatar)',
              );
              this.logger.log(JSON.stringify(result, null, 2));

              const responseData =
                result?.ComprobanteConstatarResult || result?.Result || result;

              // Parsear errores
              let errors: Array<{ code: number; msg: string }> = [];
              if (responseData.Errors?.Err) {
                const errArray = Array.isArray(responseData.Errors.Err)
                  ? responseData.Errors.Err
                  : [responseData.Errors.Err];
                errors = errArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              // Parsear eventos
              let events: Array<{ code: number; msg: string }> = [];
              if (responseData.Events?.Evt) {
                const evtArray = Array.isArray(responseData.Events.Evt)
                  ? responseData.Events.Evt
                  : [responseData.Events.Evt];
                events = evtArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              const response = {
                resultado:
                  responseData.Resultado || responseData.resultado || 'R',
                codigoAutorizacion:
                  responseData.CodigoAutorizacion ||
                  responseData.codigoAutorizacion,
                fechaEmision:
                  responseData.FechaEmision || responseData.fechaEmision,
                fechaVencimiento:
                  responseData.FechaVencimiento ||
                  responseData.fechaVencimiento,
                importeTotal: responseData.ImporteTotal
                  ? Number(responseData.ImporteTotal)
                  : undefined,
                estado: responseData.Estado || responseData.estado,
                puntoVenta: puntoVenta,
                tipoComprobante: tipoComprobante,
                numeroComprobante: numeroComprobante,
                cuitEmisor:
                  responseData.CuitEmisor ||
                  responseData.cuitEmisor ||
                  cuitEmisor,
                cuitReceptor:
                  responseData.CuitReceptor || responseData.cuitReceptor,
                errors: errors.length > 0 ? errors : undefined,
                events: events.length > 0 ? events : undefined,
              };

              this.logger.log(`Comprobante constatado: ${response.resultado}`);
              resolve(response);
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear respuesta WSCDC: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar respuesta de WSCDC: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Consulta las modalidades de autorización de comprobantes
   */
  async consultarModalidadesComprobante(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<{
    modalidades: Array<{
      Id: number;
      Desc: string;
      FchDesde: string;
      FchHasta?: string;
    }>;
    errors?: Array<{ code: number; msg: string }>;
    events?: Array<{ code: number; msg: string }>;
  }> {
    this.logger.log('=== CONSULTANDO MODALIDADES DE COMPROBANTE WSCDC ===');
    this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'wscdc',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          const request = {
            auth: {
              token: ticket.token,
              sign: ticket.sign,
              cuit: cuitEmisor.replace(/-/g, ''),
            },
          };

          client.ComprobantesModalidadConsultar(
            request,
            (err: any, result: any) => {
              if (err) {
                this.logger.error(
                  `Error en ComprobantesModalidadConsultar: ${err.message}`,
                );
                reject(
                  new BadRequestException(
                    `Error al consultar modalidades: ${err.message}`,
                  ),
                );
                return;
              }

              try {
                const responseData =
                  result?.ComprobantesModalidadConsultarResult ||
                  result?.Result ||
                  result;
                const resultGet = responseData?.ResultGet || responseData;

                // Parsear modalidades
                const modalidadesData =
                  resultGet?.Modalidad || resultGet?.modalidad || [];
                const modalidadesArray = Array.isArray(modalidadesData)
                  ? modalidadesData
                  : modalidadesData
                    ? [modalidadesData]
                    : [];

                const modalidades = modalidadesArray.map((m: any) => ({
                  Id: Number(m.Id || m.id),
                  Desc: m.Desc || m.desc || '',
                  FchDesde: m.FchDesde || m.fchDesde || '',
                  FchHasta: m.FchHasta || m.fchHasta,
                }));

                // Parsear errores y eventos
                let errors: Array<{ code: number; msg: string }> = [];
                if (responseData.Errors?.Err) {
                  const errArray = Array.isArray(responseData.Errors.Err)
                    ? responseData.Errors.Err
                    : [responseData.Errors.Err];
                  errors = errArray.map((e: any) => ({
                    code: Number(e.Code || e.code),
                    msg: e.Msg || e.msg || '',
                  }));
                }

                let events: Array<{ code: number; msg: string }> = [];
                if (responseData.Events?.Evt) {
                  const evtArray = Array.isArray(responseData.Events.Evt)
                    ? responseData.Events.Evt
                    : [responseData.Events.Evt];
                  events = evtArray.map((e: any) => ({
                    code: Number(e.Code || e.code),
                    msg: e.Msg || e.msg || '',
                  }));
                }

                this.logger.log(
                  `Modalidades encontradas: ${modalidades.length}`,
                );
                resolve({
                  modalidades,
                  errors: errors.length > 0 ? errors : undefined,
                  events: events.length > 0 ? events : undefined,
                });
              } catch (parseError: any) {
                this.logger.error(
                  `Error al parsear modalidades: ${parseError.message}`,
                );
                reject(
                  new BadRequestException(
                    `Error al procesar modalidades: ${parseError.message}`,
                  ),
                );
              }
            },
          );
        },
      );
    });
  }

  /**
   * Consulta los tipos de comprobante disponibles
   */
  async consultarTiposComprobanteWscdc(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<{
    tipos: Array<{
      Id: number;
      Desc: string;
      FchDesde: string;
      FchHasta?: string;
    }>;
    errors?: Array<{ code: number; msg: string }>;
    events?: Array<{ code: number; msg: string }>;
  }> {
    this.logger.log('=== CONSULTANDO TIPOS DE COMPROBANTE WSCDC ===');
    this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'wscdc',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          const request = {
            auth: {
              token: ticket.token,
              sign: ticket.sign,
              cuit: cuitEmisor.replace(/-/g, ''),
            },
          };

          client.ComprobantesTipoConsultar(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en ComprobantesTipoConsultar: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al consultar tipos de comprobante: ${err.message}`,
                ),
              );
              return;
            }

            try {
              const responseData =
                result?.ComprobantesTipoConsultarResult ||
                result?.Result ||
                result;
              const resultGet = responseData?.ResultGet || responseData;

              const tiposData =
                resultGet?.CbteTipo || resultGet?.cbteTipo || [];
              const tiposArray = Array.isArray(tiposData)
                ? tiposData
                : tiposData
                  ? [tiposData]
                  : [];

              const tipos = tiposArray.map((t: any) => ({
                Id: Number(t.Id || t.id),
                Desc: t.Desc || t.desc || '',
                FchDesde: t.FchDesde || t.fchDesde || '',
                FchHasta: t.FchHasta || t.fchHasta,
              }));

              let errors: Array<{ code: number; msg: string }> = [];
              if (responseData.Errors?.Err) {
                const errArray = Array.isArray(responseData.Errors.Err)
                  ? responseData.Errors.Err
                  : [responseData.Errors.Err];
                errors = errArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              let events: Array<{ code: number; msg: string }> = [];
              if (responseData.Events?.Evt) {
                const evtArray = Array.isArray(responseData.Events.Evt)
                  ? responseData.Events.Evt
                  : [responseData.Events.Evt];
                events = evtArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              this.logger.log(
                `Tipos de comprobante encontrados: ${tipos.length}`,
              );
              resolve({
                tipos,
                errors: errors.length > 0 ? errors : undefined,
                events: events.length > 0 ? events : undefined,
              });
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear tipos de comprobante: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar tipos de comprobante: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Consulta los tipos de documento disponibles
   */
  async consultarTiposDocumento(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<{
    tipos: Array<{
      Id: number;
      Desc: string;
      FchDesde: string;
      FchHasta?: string;
    }>;
    errors?: Array<{ code: number; msg: string }>;
    events?: Array<{ code: number; msg: string }>;
  }> {
    this.logger.log('=== CONSULTANDO TIPOS DE DOCUMENTO WSCDC ===');
    this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'wscdc',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          const request = {
            auth: {
              token: ticket.token,
              sign: ticket.sign,
              cuit: cuitEmisor.replace(/-/g, ''),
            },
          };

          client.DocumentosTipoConsultar(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en DocumentosTipoConsultar: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al consultar tipos de documento: ${err.message}`,
                ),
              );
              return;
            }

            try {
              const responseData =
                result?.DocumentosTipoConsultarResult ||
                result?.Result ||
                result;
              const resultGet = responseData?.ResultGet || responseData;

              const tiposData = resultGet?.DocTipo || resultGet?.docTipo || [];
              const tiposArray = Array.isArray(tiposData)
                ? tiposData
                : tiposData
                  ? [tiposData]
                  : [];

              const tipos = tiposArray.map((t: any) => ({
                Id: Number(t.Id || t.id),
                Desc: t.Desc || t.desc || '',
                FchDesde: t.FchDesde || t.fchDesde || '',
                FchHasta: t.FchHasta || t.fchHasta,
              }));

              let errors: Array<{ code: number; msg: string }> = [];
              if (responseData.Errors?.Err) {
                const errArray = Array.isArray(responseData.Errors.Err)
                  ? responseData.Errors.Err
                  : [responseData.Errors.Err];
                errors = errArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              let events: Array<{ code: number; msg: string }> = [];
              if (responseData.Events?.Evt) {
                const evtArray = Array.isArray(responseData.Events.Evt)
                  ? responseData.Events.Evt
                  : [responseData.Events.Evt];
                events = evtArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              this.logger.log(
                `Tipos de documento encontrados: ${tipos.length}`,
              );
              resolve({
                tipos,
                errors: errors.length > 0 ? errors : undefined,
                events: events.length > 0 ? events : undefined,
              });
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear tipos de documento: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar tipos de documento: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Consulta los tipos de datos opcionales disponibles
   */
  async consultarTiposOpcionales(
    cuitEmisor: string,
    certificado: string,
    clavePrivada: string,
    homologacion: boolean = false,
  ): Promise<{
    tipos: Array<{
      Id: string;
      Desc: string;
      FchDesde: string;
      FchHasta?: string;
    }>;
    errors?: Array<{ code: number; msg: string }>;
    events?: Array<{ code: number; msg: string }>;
  }> {
    this.logger.log('=== CONSULTANDO TIPOS DE DATOS OPCIONALES WSCDC ===');
    this.logger.log(`CUIT Emisor: ${cuitEmisor}`);
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const ticket = await this.getTicket(
      'wscdc',
      certificado,
      clavePrivada,
      homologacion,
    );

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          const request = {
            auth: {
              token: ticket.token,
              sign: ticket.sign,
              cuit: cuitEmisor.replace(/-/g, ''),
            },
          };

          client.OpcionalesTipoConsultar(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(
                `Error en OpcionalesTipoConsultar: ${err.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al consultar tipos opcionales: ${err.message}`,
                ),
              );
              return;
            }

            try {
              const responseData =
                result?.OpcionalesTipoConsultarResult ||
                result?.Result ||
                result;
              const resultGet = responseData?.ResultGet || responseData;

              const tiposData =
                resultGet?.OpcionalTipo || resultGet?.opcionalTipo || [];
              const tiposArray = Array.isArray(tiposData)
                ? tiposData
                : tiposData
                  ? [tiposData]
                  : [];

              const tipos = tiposArray.map((t: any) => ({
                Id: String(t.Id || t.id || ''),
                Desc: t.Desc || t.desc || '',
                FchDesde: t.FchDesde || t.fchDesde || '',
                FchHasta: t.FchHasta || t.fchHasta,
              }));

              let errors: Array<{ code: number; msg: string }> = [];
              if (responseData.Errors?.Err) {
                const errArray = Array.isArray(responseData.Errors.Err)
                  ? responseData.Errors.Err
                  : [responseData.Errors.Err];
                errors = errArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              let events: Array<{ code: number; msg: string }> = [];
              if (responseData.Events?.Evt) {
                const evtArray = Array.isArray(responseData.Events.Evt)
                  ? responseData.Events.Evt
                  : [responseData.Events.Evt];
                events = evtArray.map((e: any) => ({
                  code: Number(e.Code || e.code),
                  msg: e.Msg || e.msg || '',
                }));
              }

              this.logger.log(`Tipos opcionales encontrados: ${tipos.length}`);
              resolve({
                tipos,
                errors: errors.length > 0 ? errors : undefined,
                events: events.length > 0 ? events : undefined,
              });
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear tipos opcionales: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar tipos opcionales: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * Método Dummy para verificar funcionamiento de infraestructura
   * No requiere autenticación
   */
  async comprobanteDummy(homologacion: boolean = false): Promise<{
    appServer: string;
    dbServer: string;
    authServer: string;
  }> {
    this.logger.log('=== COMPROBANTE DUMMY WSCDC ===');
    this.logger.log(`Entorno: ${homologacion ? 'HOMOLOGACIÓN' : 'PRODUCCIÓN'}`);

    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            this.logger.error(
              `Error al crear cliente SOAP WSCDC: ${err.message}`,
            );
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
            return;
          }

          // Dummy no requiere parámetros
          const request = {};

          client.ComprobanteDummy(request, (err: any, result: any) => {
            if (err) {
              this.logger.error(`Error en ComprobanteDummy: ${err.message}`);
              reject(
                new BadRequestException(
                  `Error al ejecutar dummy: ${err.message}`,
                ),
              );
              return;
            }

            try {
              const responseData =
                result?.ComprobanteDummyResult || result?.Result || result;

              const response = {
                appServer: String(
                  responseData.AppServer || responseData.appServer || '',
                ),
                dbServer: String(
                  responseData.DbServer || responseData.dbServer || '',
                ),
                authServer: String(
                  responseData.AuthServer || responseData.authServer || '',
                ),
              };

              this.logger.log(
                `Dummy ejecutado: AppServer=${response.appServer}, DbServer=${response.dbServer}, AuthServer=${response.authServer}`,
              );
              resolve(response);
            } catch (parseError: any) {
              this.logger.error(
                `Error al parsear dummy: ${parseError.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar dummy: ${parseError.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  /**
   * WSCDC — ComprobanteConstatar COMPLETO (todos los campos obligatorios).
   *
   * A diferencia del `constatarComprobante` legacy (que mandaba solo ptoVta +
   * tipo + nro), acá enviamos CbteModo, CbteFch, ImpTotal, CodAutorizacion y,
   * condicionalmente, DocTipoReceptor/DocNroReceptor. El response lo mapeamos
   * a `APROBADO / APROBADO_CON_OBSERVACIONES / RECHAZADO` con mensaje legible.
   */
  async constatarComprobanteCompleto(params: {
    cuitAutenticador: string; // el CUIT con el que nos auth contra WSAA
    certificado: string;
    clavePrivada: string;
    cbteModo: 'CAE' | 'CAI' | 'CAEA';
    cuitEmisorComprobante: string;
    puntoVenta: number;
    tipoComprobante: number;
    numeroComprobante: number;
    fechaComprobante: string; // YYYYMMDD
    importeTotal: number;
    codAutorizacion: string; // 14 dígitos
    docTipoReceptor?: string;
    docNroReceptor?: string;
    opcionales?: Array<{ opcionalId: string; valor: string }>;
    homologacion?: boolean;
  }): Promise<{
    resultado: 'APROBADO' | 'APROBADO_CON_OBSERVACIONES' | 'RECHAZADO';
    resultadoAfip: string;
    fchProceso?: string;
    observaciones: Array<{ code: number; msg: string }>;
    errors: Array<{ code: number; msg: string }>;
    events: Array<{ code: number; msg: string }>;
    mensaje: string;
  }> {
    const homologacion = params.homologacion ?? false;
    this.logger.log('=== WSCDC ComprobanteConstatar (completo) ===');
    this.logger.log(
      `cbteModo=${params.cbteModo} emisor=${params.cuitEmisorComprobante} ptoVta=${params.puntoVenta} cbteTipo=${params.tipoComprobante} cbteNro=${params.numeroComprobante} impTotal=${params.importeTotal}`,
    );

    const ticket = await this.getTicket(
      'wscdc',
      params.certificado,
      params.clavePrivada,
      homologacion,
    );
    const urls = this.getAfipUrls(homologacion);
    const wscdcUrl = urls.wscdc;

    const cbteReq: any = {
      CbteModo: params.cbteModo,
      CuitEmisor: params.cuitEmisorComprobante.replace(/-/g, ''),
      PtoVta: params.puntoVenta,
      CbteTipo: params.tipoComprobante,
      CbteNro: params.numeroComprobante,
      CbteFch: params.fechaComprobante,
      ImpTotal: params.importeTotal,
      CodAutorizacion: params.codAutorizacion,
    };
    if (params.docTipoReceptor) cbteReq.DocTipoReceptor = params.docTipoReceptor;
    if (params.docNroReceptor) cbteReq.DocNroReceptor = params.docNroReceptor;
    if (params.opcionales && params.opcionales.length > 0) {
      cbteReq.Opcionales = {
        Opcional: params.opcionales.map((o) => ({
          OpcionalId: o.opcionalId,
          Valor: o.valor,
        })),
      };
    }

    const request = {
      Auth: {
        Token: ticket.token,
        Sign: ticket.sign,
        Cuit: params.cuitAutenticador.replace(/-/g, ''),
      },
      CmpReq: cbteReq,
    };

    return new Promise((resolve, reject) => {
      soap.createClient(
        wscdcUrl,
        { wsdl_options: { timeout: 30000 } },
        (err, client) => {
          if (err) {
            return reject(
              new BadRequestException(
                `Error al crear cliente SOAP WSCDC: ${err.message}`,
              ),
            );
          }

          client.ComprobanteConstatar(request, (soapErr: any, result: any) => {
            if (soapErr) {
              this.logger.error(
                `Error ComprobanteConstatar: ${soapErr.message}`,
              );
              return reject(
                new BadRequestException(
                  `WSCDC rechazó la consulta: ${soapErr.message}`,
                ),
              );
            }

            try {
              const body =
                result?.ComprobanteConstatarResult || result?.Result || result;
              const resultadoAfip: string = body?.Resultado ?? 'R';
              const fchProceso: string | undefined = body?.FchProceso;
              const observaciones = this.extractWscdcList(
                body?.Observaciones?.CodDescripcion,
              );
              const errors = this.extractWscdcList(body?.Errors?.Err);
              const events = this.extractWscdcList(body?.Events?.Evt);

              let resultado:
                | 'APROBADO'
                | 'APROBADO_CON_OBSERVACIONES'
                | 'RECHAZADO';
              let mensaje: string;

              if (resultadoAfip === 'A') {
                if (observaciones.length === 0) {
                  resultado = 'APROBADO';
                  mensaje = 'Comprobante válido y registrado';
                } else {
                  resultado = 'APROBADO_CON_OBSERVACIONES';
                  mensaje = `Aprobado con observaciones: ${observaciones
                    .map((o) => `${o.code}: ${o.msg}`)
                    .join('; ')}`;
                }
              } else {
                resultado = 'RECHAZADO';
                const reasons = [...errors, ...observaciones];
                mensaje =
                  reasons.length > 0
                    ? `Rechazado: ${reasons.map((e) => `${e.code}: ${e.msg}`).join('; ')}`
                    : 'Rechazado por AFIP sin detalle específico';
              }

              resolve({
                resultado,
                resultadoAfip,
                fchProceso,
                observaciones,
                errors,
                events,
                mensaje,
              });
            } catch (parseErr: any) {
              this.logger.error(
                `Error parseando respuesta WSCDC: ${parseErr.message}`,
              );
              reject(
                new BadRequestException(
                  `Error al procesar respuesta WSCDC: ${parseErr.message}`,
                ),
              );
            }
          });
        },
      );
    });
  }

  private extractWscdcList(
    raw: any,
  ): Array<{ code: number; msg: string }> {
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .filter(Boolean)
      .map((x: any) => ({
        code: Number(x.Code ?? x.code ?? 0),
        msg: String(x.Msg ?? x.msg ?? ''),
      }));
  }
}
