import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as soap from 'soap';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as xml2js from 'xml2js';
import { AfipTicketDto } from './dto';
import { 
  CreateInvoiceDto, 
  TipoComprobante, 
  CondicionIvaReceptor,
  getClaseComprobante,
  esNotaCreditoDebito,
  esFacturaCreditoElectronica,
  getCondicionesIvaValidas,
} from './dto/create-invoice.dto';
import { InvoiceResponseDto, QrDataDto } from './dto/invoice-response.dto';
import { ConsultarContribuyenteDto, ContribuyenteResponseDto } from './dto/consultar-contribuyente.dto';

@Injectable()
export class AfipService {
  private readonly logger = new Logger(AfipService.name);
  private wsaaUrl: string;

  constructor(private configService: ConfigService) {
    this.wsaaUrl = this.configService.get<string>('afip.wsaaUrl') || '';
 
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
  ): Promise<AfipTicketDto> {
    try {
      this.logger.log(`=== INICIO OBTENCIÓN DE TICKET ===`);
      this.logger.log(`Servicio solicitado: ${service}`);

      // Paso 1: Crear el TRA (Ticket de Requerimiento de Acceso)
      // Es un XML que contiene la solicitud de acceso al servicio
      const tra = this.createTRA(service);
      this.logger.log('TRA generado:');
      this.logger.log(tra);

      // Paso 2: Firmar el TRA con el certificado digital
      // Esto crea un CMS (Cryptographic Message Syntax) firmado
      this.logger.log('Firmando TRA con certificado...');
      const signedTra = this.signTRA(tra, certificado, clavePrivada);
      this.logger.log(`CMS generado (primeros 100 caracteres): ${signedTra.substring(0, 100)}...`);

      // Paso 3: Llamar al servicio WSAA para obtener el TA
      // WSAA valida la firma y devuelve un Ticket de Acceso válido
      this.logger.log('Llamando a WSAA...');
      const ticket = await this.callWSAA(signedTra);

      this.logger.log(`=== TICKET OBTENIDO ===`);
      this.logger.log(`Token (primeros 50 caracteres): ${ticket.token.substring(0, 50)}...`);
      this.logger.log(`Válido desde: ${ticket.generationTime}`);
      this.logger.log(`Válido hasta: ${ticket.expirationTime}`);
      this.logger.log('=== FIN OBTENCIÓN DE TICKET ===');

      return ticket;
    } catch (error: any) {
      this.logger.error(`Error al obtener ticket: ${error.message}`);
      this.logger.error(`Stack: ${error.stack}`);
      throw new BadRequestException(
        `Error al obtener ticket de AFIP: ${error.message}`,
      );
    }
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
  private signTRA(tra: string, certificado: string, clavePrivada: string): string {
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
      if (!certContent.includes('-----BEGIN') || !certContent.includes('-----END')) {
        throw new BadRequestException('El certificado debe estar en formato PEM con headers -----BEGIN/END-----');
      }

      if (!keyContent.includes('-----BEGIN') || !keyContent.includes('-----END')) {
        throw new BadRequestException('La clave privada debe estar en formato PEM con headers -----BEGIN/END-----');
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
        const errorOutput = execError.stderr?.toString() || execError.stdout?.toString() || execError.message;
        throw new Error(`OpenSSL error: ${errorOutput}`);
      }

      // Convertir el buffer binario a base64 (sin headers -----BEGIN/END-----)
      const cmsBase64 = cmsBuffer.toString('base64');

      return cmsBase64;
    } catch (error: any) {
      throw new BadRequestException(
        `Error al firmar el TRA: ${error.message}`,
      );
    } finally {
      // Limpiar archivos temporales
      try {
        if (fs.existsSync(traPath)) fs.unlinkSync(traPath);
        if (fs.existsSync(certPath)) fs.unlinkSync(certPath);
        if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
      } catch (cleanupError) {
        // Ignorar errores de limpieza
        this.logger.warn(`Error al limpiar archivos temporales: ${cleanupError}`);
      }
    }
  }

  /**
   * Llama al servicio WSAA para obtener el Ticket de Acceso
   */
  private async callWSAA(signedTra: string): Promise<AfipTicketDto> {
    return new Promise((resolve, reject) => {
      // Asegurar que la URL termine con ?WSDL
      const wsaaUrl = this.wsaaUrl.includes('?WSDL') 
        ? this.wsaaUrl 
        : `${this.wsaaUrl}?WSDL`;

      this.logger.log(`Conectando a WSAA: ${wsaaUrl}`);

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

      soap.createClient(
        wsaaUrl,
        soapOptions,
        (err, client) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP: ${err.message}`);
            reject(new Error(`Error al crear cliente SOAP: ${err.message}. URL: ${wsaaUrl}`));
            return;
          }

          if (!client || !client.loginCms) {
            this.logger.error(`El cliente SOAP no tiene el método loginCms`);
            reject(new Error(`El cliente SOAP no tiene el método loginCms. Verifica la URL: ${wsaaUrl}`));
            return;
          }

          this.logger.log('Cliente SOAP creado correctamente, llamando loginCms...');

          client.loginCms(
            { in0: signedTra },
            async (err: any, result: any) => {
              if (err) {
                this.logger.error(`Error al llamar WSAA: ${err.message || JSON.stringify(err)}`);
                reject(new Error(`Error al llamar WSAA: ${err.message || JSON.stringify(err)}`));
                return;
              }

              try {
                this.logger.log('Respuesta recibida de WSAA, parseando...');
                // Parsear el XML de respuesta para extraer el ticket
                const ticket = await this.parseTicketResponse(result.loginCmsReturn);
                this.logger.log('Ticket parseado correctamente');
                resolve(ticket);
              } catch (parseError: any) {
                this.logger.error(`Error al parsear respuesta: ${parseError.message}`);
                this.logger.error(`Respuesta recibida: ${JSON.stringify(result, null, 2)}`);
                reject(new Error(`Error al parsear respuesta: ${parseError.message}`));
              }
            },
          );
        },
      );
    });
  }

  /**
   * Parsea la respuesta XML del WSAA para extraer el ticket
   */
  private async parseTicketResponse(xmlResponse: string): Promise<AfipTicketDto> {
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

          const ticket: AfipTicketDto = {
            token: credentials.token,
            sign: credentials.sign,
            expirationTime: credentials.expirationTime,
            generationTime: credentials.generationTime,
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
    const utcTime = localTime + (date.getTimezoneOffset() * 60000);
    const buenosAiresTime = new Date(utcTime + (buenosAiresOffset * 60000));
    
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
  ): Promise<{ CbteNro: number; CbteFch: string }> {
    this.logger.log('=== INICIO getUltimoAutorizado ===');
    this.logger.log(`Punto de venta: ${puntoVenta}`);
    this.logger.log(`Tipo de comprobante: ${tipoComprobante}`);
    this.logger.log(`CUIT: ${cuit}`);
    this.logger.log(`Ticket: ${JSON.stringify(ticket, null, 2)}`);

    return new Promise((resolve, reject) => {
      const wsfeUrl =
        this.configService.get<string>('afip.wsfeUrl') ||
        'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';

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
            const errorMessage = (err.message || err.toString() || '').toLowerCase();
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
              (err.statusCode === 404) ||
              (err.status === 404);
            
            if (isNotFound) {
              this.logger.log('No se encontraron comprobantes previos (primera factura). Usando valores por defecto.');
              
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
            this.logger.error(`Error completo: ${JSON.stringify(err, null, 2)}`);
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
            const hasNotFoundError = data.Errors.some((error: any) => 
              error.Code === 10015 || // Código específico de AFIP para "no encontrado"
              error.Msg?.toLowerCase().includes('no encontrado') ||
              error.Msg?.toLowerCase().includes('not found') ||
              error.Msg?.toLowerCase().includes('sin comprobantes')
            );

            if (hasNotFoundError) {
              this.logger.log('No se encontraron comprobantes previos (primera factura). Usando valores por defecto.');
              
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
              this.logger.error(`Error ${index + 1}: Code=${error.Code}, Msg=${error.Msg}`);
            });
            const errorMsg = data.Errors.map((e: any) => `${e.Code}: ${e.Msg}`).join(', ');
            reject(new BadRequestException(`Error de AFIP en FECompUltimoAutorizado: ${errorMsg}`));
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
            this.logger.log('No se encontró fecha del último comprobante. Usando fecha actual.');
          }

          this.logger.log(`Último comprobante autorizado -> Nro: ${ultimoNro}, Fecha: ${ultimoFch}`);

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

      // Obtener ticket del servicio de Constancia de Inscripción
      // ID del servicio según manual v3.4: ws_sr_constancia_inscripcion
      this.logger.log('Obteniendo ticket del servicio ws_sr_constancia_inscripcion...');
      const ticket = await this.getTicket('ws_sr_constancia_inscripcion', certificado, clavePrivada);
      this.logger.log(`Ticket obtenido, válido hasta: ${ticket.expirationTime}`);

      // URL del servicio de Constancia de Inscripción
      // Según manual v3.4: usa personaServiceA5 (aunque el servicio se llama ws_sr_constancia_inscripcion)
      const padronUrl = this.configService.get<string>('afip.padronUrl') || 
        'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5?WSDL';

      this.logger.log(`URL Constancia de Inscripción: ${padronUrl}`);

      return new Promise((resolve, reject) => {
        soap.createClient(padronUrl, (err: any, client: any) => {
          if (err) {
            this.logger.error(`Error al crear cliente SOAP Padrón: ${err.message}`);
            reject(
              new BadRequestException(
                `Error al crear cliente SOAP Padrón: ${err.message}`,
              ),
            );
            return;
          }

          // Log métodos disponibles para debugging
          this.logger.log('Métodos disponibles en el cliente Constancia de Inscripción:');
          this.logger.log(Object.keys(client).filter(key => typeof client[key] === 'function').join(', '));

          // Estructura del request según documentación oficial Constancia de Inscripción v3.4
          // https://www.afip.gob.ar/ws/WSCI/manual-ws-sr-ws-constancia-inscripcion-v3.4.pdf
          const req = {
            token: ticket.token,
            sign: ticket.sign,
            cuitRepresentada: cuitEmisor,
            idPersona: cuitAConsultar, // CUIT del contribuyente a consultar
          };

          this.logger.log('=== REQUEST getPersona_v2 (Constancia de Inscripción) ===');
          this.logger.log(JSON.stringify(req, null, 2));

          // Método según documentación v3.4: getPersona_v2 (versión más reciente)
          // También existe getPersona pero se recomienda usar _v2
          const methodName = client.getPersona_v2 ? 'getPersona_v2' : 
                            client.getPersona ? 'getPersona' : null;

          if (!methodName) {
            this.logger.error('No se encontró método válido en el servicio de Constancia de Inscripción');
            this.logger.error('Métodos disponibles:', Object.keys(client).filter(k => typeof client[k] === 'function'));
            reject(
              new BadRequestException(
                'No se encontró método getPersona_v2 o getPersona en el servicio de Constancia de Inscripción de AFIP',
              ),
            );
            return;
          }

          this.logger.log(`Usando método: ${methodName}`);

          client[methodName](req, (err: any, result: any) => {
            this.logger.log(`=== RESPONSE ${methodName} (Constancia de Inscripción) ===`);
            
            if (err) {
              this.logger.error(`Error al consultar contribuyente: ${err.message}`);
              // Intentar loguear el error de forma segura
              try {
                this.logger.error(JSON.stringify(err, null, 2));
              } catch (e) {
                this.logger.error(`Error (no serializable): ${err.toString()}`);
              }
              reject(
                new BadRequestException(
                  `Error al consultar contribuyente: ${err.message}`,
                ),
              );
              return;
            }

            // Parsear respuesta según estructura del servicio de Constancia de Inscripción
            // La respuesta viene en result.personaReturn según el WSDL
            const personaReturn = result.personaReturn || result;
            
            // Loguear la respuesta de forma segura (evitando referencias circulares)
            try {
              this.logger.log(JSON.stringify(personaReturn, null, 2));
            } catch (e) {
              // Si hay referencias circulares, loguear solo las propiedades principales
              this.logger.log(`personaReturn (estructura compleja): ${JSON.stringify({
                hasDatosGenerales: !!personaReturn.datosGenerales,
                hasDatosRegimenGeneral: !!personaReturn.datosRegimenGeneral,
                errorConstancia: personaReturn.errorConstancia,
              }, null, 2)}`);
            }

            this.logger.log('=== personaReturn (Constancia de Inscripción) ===');
            // Loguear de forma segura evitando referencias circulares
            try {
              // Extraer solo los datos relevantes para evitar referencias circulares
              const safePersonaReturn = {
                errorConstancia: personaReturn.errorConstancia,
                datosGenerales: personaReturn.datosGenerales ? {
                  tipoPersona: personaReturn.datosGenerales.tipoPersona,
                  nombre: personaReturn.datosGenerales.nombre,
                  apellido: personaReturn.datosGenerales.apellido,
                  razonSocial: personaReturn.datosGenerales.razonSocial,
                  estadoClave: personaReturn.datosGenerales.estadoClave,
                  fechaInscripcion: personaReturn.datosGenerales.fechaInscripcion,
                  domicilio: personaReturn.datosGenerales.domicilio ? 
                    personaReturn.datosGenerales.domicilio.map((dom: any) => ({
                      direccion: dom.direccion,
                      localidad: dom.localidad,
                      descripcionProvincia: dom.descripcionProvincia,
                      codPostal: dom.codPostal,
                    })) : undefined,
                } : undefined,
                datosRegimenGeneral: personaReturn.datosRegimenGeneral ? {
                  impuestoIVA: personaReturn.datosRegimenGeneral.impuestoIVA ? 
                    personaReturn.datosRegimenGeneral.impuestoIVA.map((imp: any) => ({
                      idImpuesto: imp.idImpuesto,
                      descripcionImpuesto: imp.descripcionImpuesto,
                    })) : undefined,
                } : undefined,
              };
              this.logger.log(JSON.stringify(safePersonaReturn, null, 2));
            } catch (e) {
              this.logger.log(`personaReturn (no serializable, extrayendo datos básicos): ${JSON.stringify({
                hasDatosGenerales: !!personaReturn.datosGenerales,
                hasDatosRegimenGeneral: !!personaReturn.datosRegimenGeneral,
                errorConstancia: personaReturn.errorConstancia,
              }, null, 2)}`);
            }

            // Verificar errores
            if (personaReturn.errorConstancia) {
              this.logger.error(`Error de AFIP: ${personaReturn.errorConstancia}`);
              reject(
                new BadRequestException(
                  `Error al consultar contribuyente: ${personaReturn.errorConstancia}`,
                ),
              );
              return;
            }

            // Verificar que haya datos
            if (!personaReturn || !personaReturn.datosGenerales) {
              reject(
                new BadRequestException(
                  'No se encontraron datos del contribuyente',
                ),
              );
              return;
            }

            // Mapear condición IVA desde datosRegimenGeneral
            const datosGenerales = personaReturn.datosGenerales || {};
            const datosRegimenGeneral = personaReturn.datosRegimenGeneral || {};
            
            const condicionIvaMap: { [key: number]: string } = {
              1: 'No Responsable',
              2: 'Exento',
              3: 'No Gravado',
              4: 'Responsable Inscripto',
              5: 'Responsable No Inscripto (Consumidor Final)',
              6: 'Monotributo',
              7: 'Responsable Monotributo',
              8: 'Proyecto',
            };

            // Obtener condición IVA desde datosRegimenGeneral.impuestoIVA
            let condicionIvaCodigo = 5; // Default: Consumidor Final
            if (datosRegimenGeneral.impuestoIVA && datosRegimenGeneral.impuestoIVA.length > 0) {
              // Tomar el primer impuesto IVA activo
              const impuestoIVA = datosRegimenGeneral.impuestoIVA.find((imp: any) => imp.idImpuesto);
              if (impuestoIVA && impuestoIVA.idImpuesto) {
                condicionIvaCodigo = parseInt(impuestoIVA.idImpuesto);
              }
            }
            const condicionIvaTexto = condicionIvaMap[condicionIvaCodigo] || 'Desconocida';

            // Obtener tipo de persona
            const tipoPersona = datosGenerales.tipoPersona === 'FISICA' ? 'FISICA' : 
                               datosGenerales.tipoPersona === 'JURIDICA' ? 'JURIDICA' :
                               datosGenerales.tipoPersona || 'FISICA';

            // Denominación: para personas físicas usa nombre + apellido, para jurídicas usa razón social
            let denominacion = 'Sin denominación';
            if (tipoPersona === 'FISICA') {
              const nombre = datosGenerales.nombre || '';
              const apellido = datosGenerales.apellido || '';
              denominacion = `${nombre} ${apellido}`.trim() || 'Sin denominación';
            } else {
              denominacion = datosGenerales.razonSocial || 'Sin denominación';
            }

            // Estado: según documentación viene en estadoClave
            const estadoClave = datosGenerales.estadoClave || '';
            const estado = estadoClave === 'ACTIVO' || estadoClave === 'Activo' ? 'ACTIVO' : 
                          estadoClave === 'INACTIVO' || estadoClave === 'Inactivo' ? 'INACTIVO' :
                          estadoClave || 'ACTIVO';

            // Domicilio: devolver el objeto completo tal cual viene de AFIP
            let domicilio: any = undefined;
            
            // Primero intentar con domicilioFiscal (estructura más común en Constancia de Inscripción)
            if (datosGenerales.domicilioFiscal) {
              domicilio = datosGenerales.domicilioFiscal;
            }
            // Si no hay domicilioFiscal, intentar con array domicilio
            else if (datosGenerales.domicilio && Array.isArray(datosGenerales.domicilio) && datosGenerales.domicilio.length > 0) {
              domicilio = datosGenerales.domicilio[0]; // Tomar el primer domicilio
            }

            // Fecha de inscripción (si está disponible)
            const fechaInscripcion = datosGenerales.fechaInscripcion || undefined;

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

            this.logger.log('=== DATOS CONTRIBUYENTE (Constancia de Inscripción) ===');
            this.logger.log(JSON.stringify(response, null, 2));
            this.logger.log('=== FIN CONSULTA CONTRIBUYENTE ===');

            resolve(response);
          });
        });
      });
    } catch (error: any) {
      this.logger.error(`Error general al consultar contribuyente: ${error.message}`);
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
      this.logger.log(`Datos recibidos: ${JSON.stringify(invoiceData, null, 2)}`);

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
      this.logger.log(`CUIT Emisor: ${cuitEmisor}`);

      // Si no se proporciona ticket, obtener uno nuevo usando los certificados del request
      let authTicket = ticket;
      if (!authTicket || !this.validateTicket(authTicket)) {
        this.logger.log('Ticket no válido o no proporcionado, obteniendo nuevo ticket...');
        authTicket = await this.getTicket(
          'wsfe',
          certificado,
          clavePrivada,
        );
        this.logger.log(`Ticket obtenido, válido hasta: ${authTicket.expirationTime}`);
      } else {
        this.logger.log(`Usando ticket existente, válido hasta: ${authTicket.expirationTime}`);
      }

      // URL del servicio WSFE (Facturación Electrónica)
      const wsfeUrl = this.configService.get<string>('afip.wsfeUrl') || 
        'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';

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
        );
      } catch (error: any) {
        this.logger.error('=== ERROR EN getUltimoAutorizado ===');
        this.logger.error(JSON.stringify(error, null, 2));
        // Si el error es "Not Found", es la primera factura - usar valores por defecto
        const errorMessage = (error.message || '').toLowerCase();
        if (errorMessage.includes('not found') || errorMessage.includes('no encontrado')) {
          this.logger.log('No se encontraron comprobantes previos (primera factura). Usando valores por defecto.');
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, '0');
          const day = String(now.getDate()).padStart(2, '0');
          const fechaActual = `${year}${month}${day}`;
          ultimo = { CbteNro: 0, CbteFch: fechaActual };
        } else {
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
      let fechaCbte = invoiceData.fechaComprobante;
      if (ultimaFecha && fechaCbte < ultimaFecha) {
        this.logger.warn(
          `La fecha enviada (${fechaCbte}) es anterior a la del último comprobante (${ultimaFecha}). Usando ${ultimaFecha}.`,
        );
        fechaCbte = ultimaFecha;
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
        docNro = invoiceData.cuitCliente === '0' ? 0 : parseInt(invoiceData.cuitCliente.replace(/-/g, ''));
        if (isNaN(docNro) || docNro <= 0) {
          throw new BadRequestException(
            `DocNro inválido para DocTipo ${invoiceData.tipoDocumento}. Debe ser un número válido > 0`
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
            this.logger.log(`Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 1 (Responsable Inscripto)`);
            break;
          case 'B':
          case 'FCE_B':
            // Clase B: receptor puede ser Consumidor Final, Exento, etc.
            condicionIva = CondicionIvaReceptor.CONSUMIDOR_FINAL;
            this.logger.log(`Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 5 (Consumidor Final)`);
            break;
          case 'C':
          case 'FCE_C':
            // Clase C (Monotributo): receptor puede ser cualquiera
            condicionIva = CondicionIvaReceptor.CONSUMIDOR_FINAL;
            this.logger.log(`Comprobante clase ${claseComprobante}: usando condición IVA por defecto = 5 (Consumidor Final)`);
            break;
        }
      } else {
        // Validar que la condición IVA sea válida para la clase de comprobante
        const condicionesValidas = getCondicionesIvaValidas(claseComprobante);
        if (condicionesValidas.length > 0 && !condicionesValidas.includes(condicionIva)) {
          this.logger.warn(`Condición IVA ${condicionIva} no es válida para clase ${claseComprobante}. Valores válidos: ${condicionesValidas.join(', ')}`);
        }
      }

      this.logger.log(`DocTipo: ${invoiceData.tipoDocumento}, DocNro: ${docNro}`);
      this.logger.log(`MonId: ${monId}, MonCotiz: ${monCotiz}`);
      this.logger.log(`Concepto: ${invoiceData.concepto} (1=Productos, 2=Servicios, 3=Productos+Servicios)`);
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
        this.logger.log(`Descuento/Bonificación aplicado: ${invoiceData.importeDescuento}`);
      }

      // Incluir condición IVA del receptor (obligatorio desde 01/02/2026)
      if (condicionIva) {
        detalle.IvaCond = condicionIva;
      }

      // Array de IVA - Requerido para Facturas A, B, M cuando hay IVA
      // Según Manual ARCA-COMPG v4.0: debe enviarse el desglose de alícuotas
      if (invoiceData.iva && invoiceData.iva.length > 0) {
        detalle.Iva = {
          AlicIva: invoiceData.iva.map(iva => ({
            Id: iva.Id,
            BaseImp: iva.BaseImp,
            Importe: iva.Importe,
          })),
        };
        this.logger.log(`Array de IVA incluido con ${invoiceData.iva.length} alícuota(s)`);
      } else if (invoiceData.importeIva > 0 && (claseComprobante === 'A' || claseComprobante === 'B' || claseComprobante === 'M')) {
        // Si hay IVA pero no se envió el array, crear uno con IVA 21%
        detalle.Iva = {
          AlicIva: [{
            Id: 5, // 21%
            BaseImp: invoiceData.importeNetoGravado,
            Importe: invoiceData.importeIva,
          }],
        };
        this.logger.log('Array de IVA generado automáticamente con alícuota 21%');
      }

      // Comprobantes asociados - Requerido para Notas de Crédito/Débito
      if (esNotaCreditoDebito(tipoComprobanteValue)) {
        if (invoiceData.comprobantesAsociados && invoiceData.comprobantesAsociados.length > 0) {
          detalle.CbtesAsoc = {
            CbteAsoc: invoiceData.comprobantesAsociados.map(cbte => {
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
          this.logger.log(`Comprobantes asociados incluidos: ${invoiceData.comprobantesAsociados.length}`);
        } else {
          this.logger.warn('Nota de Crédito/Débito sin comprobantes asociados - AFIP puede rechazarla');
        }
      }

      // Campos para Facturas de Crédito Electrónica (MiPyME)
      if (esFacturaCreditoElectronica(tipoComprobanteValue)) {
        if (invoiceData.cbu) {
          detalle.Opcionales = {
            Opcional: [
              { Id: 2101, Valor: invoiceData.cbu.Cbu }, // CBU
            ],
          };
          if (invoiceData.cbu.Alias) {
            detalle.Opcionales.Opcional.push({ Id: 2102, Valor: invoiceData.cbu.Alias });
          }
          this.logger.log('Datos de CBU incluidos para FCE');
        }
        if (invoiceData.fceVtoPago) {
          detalle.FchVtoPago = invoiceData.fceVtoPago;
          this.logger.log(`Fecha vencimiento FCE: ${invoiceData.fceVtoPago}`);
        }
      }

      // Fechas de servicio - Solo para Concepto 2 (Servicios) o 3 (Productos + Servicios)
      if (invoiceData.concepto === 2 || invoiceData.concepto === 3) {
        detalle.FchServDesde = invoiceData.fechaServicioDesde || fechaCbte;
        detalle.FchServHasta = invoiceData.fechaServicioHasta || fechaCbte;
        detalle.FchVtoPago = invoiceData.fechaVencimientoPago || fechaCbte;
        this.logger.log('Incluyendo fechas de servicio (Concepto 2 o 3)');
      } else {
        this.logger.log('Omitiendo fechas de servicio (Concepto 1 - Productos)');
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
            this.logger.error(`Error al crear cliente SOAP WSFE: ${err.message}`);
            this.logger.error(`Stack: ${err.stack}`);
            reject(new BadRequestException(`Error al crear cliente SOAP WSFE: ${err.message}`));
            return;
          }

          this.logger.log('Cliente SOAP WSFE creado correctamente');

          // Llamar al método FECAESolicitar del servicio WSFE
          client.FECAESolicitar(fecaeReq, async (err: any, result: any) => {
            if (err) {
              this.logger.error(`Error al llamar FECAESolicitar: ${err.message}`);
              this.logger.error(`Error completo: ${JSON.stringify(err, null, 2)}`);
              reject(new BadRequestException(`Error al crear factura: ${err.message}`));
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
                  ? (Array.isArray(response.Errors.Err) ? response.Errors.Err : [response.Errors.Err])
                  : (Array.isArray(response.Errors) ? response.Errors : []);
                
                if (errArray.length > 0) {
                  this.logger.error('=== ERRORES CRÍTICOS DE AFIP (Cabecera) ===');
                  errArray.forEach((error: any, index: number) => {
                    const code = error.Code || error.code || 'N/A';
                    const msg = error.Msg || error.msg || error.message || JSON.stringify(error);
                    this.logger.error(`Error ${index + 1}: Code=${code}, Msg=${msg}`);
                  });
                }
              }

              // Verificar que existe FeDetResp
              if (!response.FeDetResp) {
                this.logger.error('No se encontró FeDetResp en la respuesta');
                reject(new BadRequestException('No se recibió respuesta válida de AFIP (sin FeDetResp)'));
                return;
              }

              // Obtener la factura (puede ser array o objeto único)
              const factura = response.FeDetResp.FECAEDetResponse?.[0] || response.FeDetResp.FECAEDetResponse;
              
              if (!factura) {
                this.logger.error('No se encontró FECAEDetResponse en la respuesta');
                this.logger.error(`FeDetResp completo: ${JSON.stringify(response.FeDetResp, null, 2)}`);
                reject(new BadRequestException('No se recibió respuesta válida de AFIP (sin FECAEDetResponse)'));
                return;
              }

              this.logger.log('=== DETALLE DE LA FACTURA ===');
              this.logger.log(JSON.stringify(factura, null, 2));

              // Extraer errores y observaciones (pueden estar en diferentes formatos)
              // AFIP puede enviar:
              // 1. Errors.Err[] a nivel de respuesta (errores críticos)
              // 2. Observaciones.Obs[] en el detalle (observaciones/advertencias)
              let observaciones: string[] = [];
              let observacionesDetalladas: Array<{ code: number; msg: string }> = [];

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
              if (observaciones.length > 0 && observacionesDetalladas.length === 0) {
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
                  const erroresFormateados = observacionesDetalladas.map(obs => 
                    `[${obs.code}] ${obs.msg}`
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
                (exception as any).observaciones = observacionesDetalladas.length > 0 
                  ? observacionesDetalladas 
                  : observaciones.map(msg => ({ code: 0, msg }));
                
                reject(exception);
                return;
              }

              // Si el resultado es "P" (Parcialmente aprobado) o "A" (Aprobado)
              if (resultado === 'A' || resultado === 'P') {
                this.logger.log(`=== FACTURA ${resultado === 'A' ? 'APROBADA' : 'PARCIALMENTE APROBADA'} ===`);
                this.logger.log(`CAE: ${factura.CAE}`);
                this.logger.log(`Número de comprobante: ${factura.CbteDesde || invoiceData.numeroComprobante}`);
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
                observaciones: observaciones.length > 0 ? observaciones : undefined,
                ...(observacionesDetalladas.length > 0 && { observacionesDetalladas }),
                ...(qrData && { qrData }),
              };

              this.logger.log('=== RESPUESTA FINAL ===');
              this.logger.log(JSON.stringify(invoiceResponse, null, 2));
              this.logger.log('=== FIN CREACIÓN DE FACTURA ===');

              resolve(invoiceResponse);
            } catch (parseError: any) {
              this.logger.error(`Error al procesar respuesta: ${parseError.message}`);
              this.logger.error(`Stack: ${parseError.stack}`);
              reject(new BadRequestException(`Error al procesar respuesta: ${parseError.message}`));
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
  ): Promise<Array<{ Id: number; Desc: string; FchDesde: string; FchHasta: string }>> {
    const ticket = await this.getTicket('wsfe', certificado, clavePrivada);
    const wsfeUrl = this.configService.get<string>('afip.wsfeUrl') || 
      'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(new BadRequestException(`Error al crear cliente SOAP: ${err.message}`));
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
            reject(new BadRequestException(`Error al obtener tipos de comprobante: ${err.message}`));
            return;
          }

          const tipos = result.FEParamGetTiposCbteResult?.ResultGet?.CbteTipo || [];
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
  ): Promise<Array<{ Nro: number; EmisionTipo: string; Bloqueado: string; FchBaja: string }>> {
    const ticket = await this.getTicket('wsfe', certificado, clavePrivada);
    const wsfeUrl = this.configService.get<string>('afip.wsfeUrl') || 
      'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(new BadRequestException(`Error al crear cliente SOAP: ${err.message}`));
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
            reject(new BadRequestException(`Error al obtener puntos de venta: ${err.message}`));
            return;
          }

          const ptos = result.FEParamGetPtosVentaResult?.ResultGet?.PtoVenta || [];
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
  ): Promise<Array<{ Id: number; Desc: string; Cmp_Clase: string }>> {
    const ticket = await this.getTicket('wsfe', certificado, clavePrivada);
    const wsfeUrl = this.configService.get<string>('afip.wsfeUrl') || 
      'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL';

    return new Promise((resolve, reject) => {
      soap.createClient(wsfeUrl, (err, client) => {
        if (err) {
          reject(new BadRequestException(`Error al crear cliente SOAP: ${err.message}`));
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

        client.FEParamGetCondicionIvaReceptor(request, (err: any, result: any) => {
          if (err) {
            reject(new BadRequestException(`Error al obtener condiciones IVA: ${err.message}`));
            return;
          }

          const condiciones = result.FEParamGetCondicionIvaReceptorResult?.ResultGet?.CondicionIvaReceptor || [];
          const condicionesArray = Array.isArray(condiciones) ? condiciones : [condiciones];
          resolve(condicionesArray);
        });
      });
    });
  }
}

