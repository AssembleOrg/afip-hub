import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as QRCode from 'qrcode';
import * as Handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';
import { GenerateInvoicePdfDto } from './dto/generate-invoice-pdf.dto';
import { GenerateInvoicePdfBatchDto } from './dto/generate-invoice-pdf-batch.dto';

import { chromium, type Browser } from 'playwright';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const archiver = require('archiver');

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  // chrome_crashpad_handler sobrevive a browser.close(): un huérfano por launch
  // va sumando tasks hasta agotar pids.max del contenedor (lección de
  // afip-comprobantes / multas-next).
  '--disable-crashpad',
];

@Injectable()
export class InvoicePdfService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoicePdfService.name);
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private template: HandlebarsTemplateDelegate;

  constructor() {
    // Try multiple paths to find the template
    const possiblePaths = [
      path.join(__dirname, 'templates', 'invoice.hbs'),
      path.join(process.cwd(), 'dist', 'src', 'modules', 'afip', 'templates', 'invoice.hbs'),
      path.join(process.cwd(), 'src', 'modules', 'afip', 'templates', 'invoice.hbs'),
    ];

    let templateSource = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        templateSource = fs.readFileSync(p, 'utf-8');
        this.logger.log(`Template cargado desde: ${p}`);
        break;
      }
    }

    if (!templateSource) {
      throw new Error(`Template invoice.hbs no encontrado. Paths probados: ${possiblePaths.join(', ')}`);
    }

    this.template = Handlebars.compile(templateSource);
  }

  async onModuleDestroy() {
    const browser = this.browser;
    this.browser = null;
    await browser?.close();
  }

  /**
   * Un solo Chromium compartido. Si se cae (OOM, crash), `disconnected` lo
   * descarta y el próximo pedido lo relanza: antes quedaba cacheado muerto y
   * todos los PDFs devolvían 500 hasta reiniciar el servicio.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) {
      this.launching = chromium
        .launch({ headless: true, args: BROWSER_ARGS })
        .then((browser) => {
          browser.on('disconnected', () => {
            if (this.browser !== browser) return; // cierre propio (onModuleDestroy)
            this.browser = null;
            this.logger.warn('Chromium desconectado; se relanza en el próximo PDF');
          });
          this.browser = browser;
          return browser;
        })
        .finally(() => {
          this.launching = null;
        });
    }
    return this.launching;
  }

  async generatePdf(dto: GenerateInvoicePdfDto): Promise<Buffer> {
    const qrDataUrl = await this.generateQrDataUrl(dto);
    const html = this.renderHtml(dto, qrDataUrl);

    try {
      return await this.renderPdf(html);
    } catch (err) {
      // Un reintento con navegador nuevo si el anterior murió en el medio.
      if (this.browser?.isConnected()) throw err;
      this.logger.warn(`PDF falló con Chromium caído, reintento: ${err.message}`);
      return this.renderPdf(html);
    }
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async generatePdfBatch(batchDto: GenerateInvoicePdfBatchDto): Promise<Buffer> {
    this.logger.log(`Generando ${batchDto.facturas.length} PDFs en lote...`);

    return new Promise<Buffer>(async (resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];

      archive.on('data', (chunk: Buffer) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', (err: Error) => reject(err));

      for (const factura of batchDto.facturas) {
        const pdfDto: GenerateInvoicePdfDto = {
          tipoComprobante: batchDto.tipoComprobante,
          letra: batchDto.letra,
          puntoVenta: batchDto.puntoVenta,
          numeroComprobante: factura.numeroComprobante,
          fechaEmision: factura.fechaEmision,
          cae: factura.cae,
          caeFechaVencimiento: factura.fechaEmision,
          emisor: batchDto.emisor,
          receptor: {
            razonSocial: 'Consumidor Final',
            documento: '0',
            tipoDocumento: 'CONSUMIDOR FINAL',
            condicionIva: 'Consumidor Final',
          },
          items: [
            {
              codigo: '001',
              descripcion: batchDto.itemDescripcion ?? 'Venta',
              cantidad: 1,
              precioUnitario: factura.importeTotal,
              subtotal: factura.importeTotal,
            },
          ],
          importeNetoGravado: 0,
          importeTotal: factura.importeTotal,
          importeIva: 0,
          moneda: 'PES',
          cotizacionMoneda: 1,
        };

        try {
          const pdfBuffer = await this.generatePdf(pdfDto);
          const pvStr = String(batchDto.puntoVenta).padStart(5, '0');
          const numStr = String(factura.numeroComprobante).padStart(8, '0');
          const filename = `Factura_C_${pvStr}-${numStr}.pdf`;

          archive.append(pdfBuffer, { name: filename });
          this.logger.log(`PDF generado: ${filename}`);
        } catch (err) {
          this.logger.error(`Error generando PDF para comprobante ${factura.numeroComprobante}: ${err.message}`);
        }
      }

      archive.finalize();
    });
  }

  private renderHtml(dto: GenerateInvoicePdfDto, qrDataUrl: string): string {
    const pvStr = String(dto.puntoVenta).padStart(5, '0');
    const numStr = String(dto.numeroComprobante).padStart(8, '0');
    const isFacturaA = dto.letra === 'A' || dto.letra === 'M';

    const subtotalGeneral = dto.items.reduce((acc, i) => acc + (i.subtotal || 0), 0);

    const data = {
      // Encabezado
      tipoComprobante: dto.tipoComprobante.toUpperCase(),
      // Título del recuadro derecho: sin la letra final (la letra ya va en el
      // recuadro central). "FACTURA C" -> "FACTURA", "NOTA DE CREDITO B" -> "NOTA DE CREDITO".
      tipoComprobanteTitulo: dto.tipoComprobante
        .toUpperCase()
        .replace(/\s+[ABCM]$/, ''),
      letra: dto.letra,
      codigoComprobante: this.getTipoComprobanteCode(dto.tipoComprobante).toString().padStart(3, '0'),
      puntoVentaStr: pvStr,
      numeroComprobanteStr: numStr,
      fechaEmision: dto.fechaEmision,

      // Emisor (CUIT sin guiones, como el comprobante oficial)
      emisor: { ...dto.emisor },

      // Receptor (documento sin guiones; consumidor final => en blanco)
      receptor: {
        ...dto.receptor,
        documentoFormateado: dto.receptor.documento === '0' ? '' : dto.receptor.documento,
      },

      // Período
      periodoDesde: dto.periodoDesde,
      periodoHasta: dto.periodoHasta,
      fechaVencimientoPago: dto.fechaVencimientoPago,
      condicionVenta: dto.condicionVenta,

      // Items (montos SIN "$": el signo va en las etiquetas de totales)
      isFacturaA,
      items: dto.items.map((item) => {
        const impBonif =
          item.bonificacion && item.bonificacion > 0
            ? (item.precioUnitario * item.cantidad * item.bonificacion) / 100
            : 0;
        return {
          ...item,
          cantidadStr: this.formatNumber(item.cantidad),
          unidadStr: item.unidad || 'unidades',
          precioUnitarioStr: this.formatNumber(item.precioUnitario),
          bonificacionStr: this.formatNumber(item.bonificacion || 0),
          impBonificadoStr: this.formatNumber(impBonif),
          subtotalStr: this.formatNumber(item.subtotal),
        };
      }),

      // Totales (números sin "$"; el "$" está en el label del template)
      subtotalGeneralStr: this.formatNumber(subtotalGeneral),
      importeNetoGravadoStr: this.formatNumber(dto.importeNetoGravado),
      importeIvaStr: dto.importeIva ? this.formatNumber(dto.importeIva) : null,
      importeTributosStr:
        dto.importeTributos != null ? this.formatNumber(dto.importeTributos) : null,
      importeTotalStr: this.formatNumber(dto.importeTotal),

      // Observaciones
      observaciones: dto.observaciones,

      // CAE + QR
      cae: dto.cae,
      caeFechaVencimiento: dto.caeFechaVencimiento,
      qrDataUrl,
    };

    return this.template(data);
  }

  private async generateQrDataUrl(dto: GenerateInvoicePdfDto): Promise<string> {
    const qrJson = {
      ver: 1,
      fecha: this.convertDateToISO(dto.fechaEmision),
      cuit: parseInt(dto.emisor.cuit),
      ptoVta: dto.puntoVenta,
      tipoCmp: this.getTipoComprobanteCode(dto.tipoComprobante),
      nroCmp: dto.numeroComprobante,
      importe: dto.importeTotal,
      moneda: dto.moneda || 'PES',
      ctz: dto.cotizacionMoneda || 1,
      tipoDocRec: this.getTipoDocumentoCode(dto.receptor.tipoDocumento),
      nroDocRec: parseInt(dto.receptor.documento) || 0,
      tipoCodAut: 'E',
      codAut: parseInt(dto.cae),
    };

    const base64Data = Buffer.from(JSON.stringify(qrJson)).toString('base64');
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${base64Data}`;

    return QRCode.toDataURL(qrUrl, { width: 200, margin: 1 });
  }

  // --- Utilidades ---

  private formatCuit(cuit: string): string {
    if (cuit.length === 11) {
      return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
    }
    return cuit;
  }

  private formatCurrency(amount: number): string {
    return `$ ${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Número es-AR con 2 decimales, SIN símbolo (ej: 78000,00). */
  private formatNumber(amount: number): string {
    return (amount ?? 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private convertDateToISO(date: string): string {
    const parts = date.split('/');
    if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
    return date;
  }

  private getTipoComprobanteCode(tipo: string): number {
    const map: Record<string, number> = {
      'FACTURA A': 1, 'NOTA DE DEBITO A': 2, 'NOTA DE CREDITO A': 3, 'RECIBO A': 4,
      'FACTURA B': 6, 'NOTA DE DEBITO B': 7, 'NOTA DE CREDITO B': 8, 'RECIBO B': 9,
      'FACTURA C': 11, 'NOTA DE DEBITO C': 12, 'NOTA DE CREDITO C': 13, 'RECIBO C': 15,
      'FACTURA M': 51, 'NOTA DE DEBITO M': 52, 'NOTA DE CREDITO M': 53,
      'FACTURA DE CREDITO ELECTRONICA A': 201, 'FACTURA DE CREDITO ELECTRONICA B': 206, 'FACTURA DE CREDITO ELECTRONICA C': 211,
    };
    return map[tipo.toUpperCase()] || 6;
  }

  private getTipoDocumentoCode(tipo: string): number {
    const map: Record<string, number> = {
      'CUIT': 80, 'CUIL': 86, 'CDI': 87, 'DNI': 96,
      'PASAPORTE': 94, 'CI EXTRANJERA': 91, 'EN TRAMITE': 90, 'CONSUMIDOR FINAL': 99,
    };
    return map[tipo.toUpperCase()] || 99;
  }
}
