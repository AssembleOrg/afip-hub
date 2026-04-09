import { Controller, Post, Get, Body, Query, Res, Header, StreamableFile, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProduces } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AfipService } from './afip.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { AfipLoginDto, AfipTicketDto } from './dto';
import { CreateInvoiceDto, AlicuotaIva, Concepto } from './dto/create-invoice.dto';
import { CreateCommerceInvoiceDto } from './dto/create-commerce-invoice.dto';
import { InvoiceResponseDto, QrDataDto } from './dto/invoice-response.dto';
import { UltimoAutorizadoDto, UltimoAutorizadoResponseDto } from './dto/ultimo-autorizado.dto';
import { ConsultarContribuyenteDto, ContribuyenteResponseDto } from './dto/consultar-contribuyente.dto';
import { 
  AfipParamsRequestDto, 
  CondicionesIvaRequestDto, 
  TipoComprobanteResponseDto,
  PuntoVentaResponseDto,
  CondicionIvaReceptorResponseDto,
  GenerarQrRequestDto,
} from './dto/afip-params.dto';
import {
  ConsultarComunicacionesDto,
  ConsumirComunicacionDto,
  ConsultarSistemasPublicadoresDto,
  ConsultarEstadosDto,
  ComunicacionesPaginadasResponseDto,
  ComunicacionDetalleResponseDto,
  SistemasPublicadoresResponseDto,
  EstadosComunicacionResponseDto,
} from './dto/ventanilla-electronica.dto';
import {
  ComprobanteConstatarDto,
  ComprobantesModalidadConsultarDto,
  ComprobantesTipoConsultarDto,
  DocumentosTipoConsultarDto,
  OpcionalesTipoConsultarDto,
  ComprobanteDummyDto,
  ComprobanteConstatarResponseDto,
  ModalidadResponseDto,
  TipoComprobanteWscdcResponseDto,
  TipoDocumentoResponseDto,
  TipoOpcionalResponseDto,
  DummyResponseDto,
} from './dto/wscdc.dto';
import { GenerateInvoicePdfDto } from './dto/generate-invoice-pdf.dto';
import { GenerateInvoicePdfBatchDto } from './dto/generate-invoice-pdf-batch.dto';
import { ResponseDto } from '@/common/dto';
import { Auditory, Public } from '@/common';

@ApiTags('AFIP')
@Controller('afip')
@Public()
export class AfipController {
  constructor(
    private readonly afipService: AfipService,
    private readonly configService: ConfigService,
    private readonly invoicePdfService: InvoicePdfService,
  ) {}

  @Get('status')
  @ApiOperation({ 
    summary: 'Estado del servicio y entorno AFIP',
    description: 'Muestra el entorno de AFIP configurado (producción/homologación) y las URLs activas.'
  })
  @ApiResponse({
    status: 200,
    description: 'Estado del servicio',
  })
  getStatus() {
    const environment = this.configService.get<string>('afip.environment') || 'homologacion';
    const wsaaUrl = this.configService.get<string>('afip.wsaaUrl') || '';
    const wsfeUrl = this.configService.get<string>('afip.wsfeUrl') || '';
    
    return {
      status: 'ok',
      environment,
      isProduction: environment === 'production',
      urls: {
        wsaa: wsaaUrl,
        wsfe: wsfeUrl,
      },
      warning: environment === 'production' 
        ? '⚠️ PRODUCCIÓN: Las facturas emitidas son fiscalmente válidas'
        : '✅ HOMOLOGACIÓN: Entorno de pruebas, sin efecto fiscal',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('login')
  @Auditory('Obtener ticket de AFIP')
  @ApiOperation({ summary: 'Obtener ticket de acceso de AFIP' })
  @ApiResponse({
    status: 200,
    description: 'Ticket obtenido exitosamente',
    type: ResponseDto<AfipTicketDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async getTicket(
    @Body() afipLoginDto: AfipLoginDto,
  ): Promise<ResponseDto<AfipTicketDto>> {
    const ticket = await this.afipService.getTicket(
      afipLoginDto.service,
      (afipLoginDto as any).certificado,
      (afipLoginDto as any).clavePrivada,
    );
    return new ResponseDto(ticket, 'Ticket obtenido exitosamente');
  }

  @Post('invoice')
  @Auditory('Crear factura electrónica')
  @ApiOperation({ 
    summary: 'Crear factura electrónica en AFIP',
    description: `
Crea un comprobante electrónico (factura, nota de crédito, nota de débito, etc.) en AFIP.

**Tipos de comprobante soportados:**
- Factura A (1), B (6), C (11)
- Nota de Crédito A (3), B (8), C (13)
- Nota de Débito A (2), B (7), C (12)
- Factura de Crédito Electrónica A (201), B (206), C (211)
- Nota de Crédito FCE A (203), B (208), C (213)
- Nota de Débito FCE A (202), B (207), C (212)

**Condiciones IVA del receptor (según clase de comprobante):**
- Clase A/M: 1 (Resp. Inscripto), 6 (Monotributo), 13, 16
- Clase B: 4 (Exento), 5 (Cons. Final), 7, 8, 9, 10, 15
- Clase C: 1, 4, 5, 6, 7, 8, 9, 10, 13, 15, 16

**Importante:** Desde 01/02/2026 el campo condicionIvaReceptor es OBLIGATORIO.
    `
  })
  @ApiResponse({
    status: 200,
    description: 'Factura creada exitosamente',
    type: ResponseDto<InvoiceResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async createInvoice(
    @Body() createInvoiceDto: CreateInvoiceDto,
  ): Promise<ResponseDto<InvoiceResponseDto>> {
    console.log('createInvoiceDto', createInvoiceDto);
    const invoice = await this.afipService.createInvoice(createInvoiceDto);
    return new ResponseDto(invoice, 'Factura creada exitosamente');
  }

  @Post('invoice/comercio')
  @Auditory('Crear factura electrónica para comercio (múltiples ítems)')
  @ApiOperation({
    summary: 'Crear factura para comercio con múltiples ítems',
    description: `
Recibe \`items[]\` de productos/servicios, calcula automáticamente neto, IVA y total,
y emite el comprobante en AFIP reutilizando el flujo estándar.

Nota: AFIP WSFE no persiste el detalle de ítems; se autoriza por importes agregados.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Factura de comercio creada exitosamente',
    type: ResponseDto<InvoiceResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async createCommerceInvoice(
    @Body() createCommerceInvoiceDto: CreateCommerceInvoiceDto,
  ): Promise<ResponseDto<InvoiceResponseDto>> {
    const invoiceRequest = this.mapCommerceInvoiceToStandard(createCommerceInvoiceDto);
    const invoice = await this.afipService.createInvoice(invoiceRequest);
    return new ResponseDto(invoice, 'Factura de comercio creada exitosamente');
  }

  @Post('ultimo-autorizado')
  @Auditory('Consultar último comprobante autorizado')
  @ApiOperation({ 
    summary: 'Obtener el último comprobante autorizado para un punto de venta y tipo',
    description: 'Consulta el último número de comprobante autorizado para un punto de venta y tipo específico. Útil para determinar el próximo número a usar.'
  })
  @ApiResponse({
    status: 200,
    description: 'Último comprobante obtenido exitosamente',
    type: ResponseDto<UltimoAutorizadoResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async getUltimoAutorizado(
    @Body() ultimoAutorizadoDto: UltimoAutorizadoDto,
  ): Promise<ResponseDto<UltimoAutorizadoResponseDto>> {
    try {
      // Obtener ticket primero usando los certificados del request
      const dto = ultimoAutorizadoDto as any;
      const homologacion = ultimoAutorizadoDto.homologacion !== undefined ? ultimoAutorizadoDto.homologacion : false;
      const ticket = await this.afipService.getTicket(
        'wsfe',
        dto.certificado,
        dto.clavePrivada,
        homologacion,
      );
      
      const cuitEmisor = dto.cuitEmisor.replace(/-/g, ''); // Remover guiones si los tiene
      
      // Consultar último autorizado
      // Si no hay comprobantes previos (primera factura), el servicio devuelve CbteNro: 0
      const ultimo = await this.afipService.getUltimoAutorizado(
        ultimoAutorizadoDto.puntoVenta,
        ultimoAutorizadoDto.tipoComprobante,
        ticket,
        cuitEmisor,
        homologacion,
      );

      const response: UltimoAutorizadoResponseDto = {
        CbteNro: ultimo.CbteNro,
        CbteFch: ultimo.CbteFch,
        proximoNumero: ultimo.CbteNro + 1,
      };

      return new ResponseDto(response, 'Último comprobante obtenido exitosamente');
    } catch (error: any) {
      // Si el error contiene "Not Found", es la primera factura - devolver valores por defecto
      const errorMessage = (error.message || '').toLowerCase();
      if (errorMessage.includes('not found') || errorMessage.includes('no encontrado')) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const fechaActual = `${year}${month}${day}`;
        
        const response: UltimoAutorizadoResponseDto = {
          CbteNro: 0,
          CbteFch: fechaActual,
          proximoNumero: 1,
        };
        
        return new ResponseDto(response, 'No se encontraron comprobantes previos (primera factura)');
      }
      
      // Re-lanzar otros errores
      throw error;
    }
  }

  @Post('consultar-contribuyente')
  @Auditory('Consultar datos de contribuyente')
  @ApiOperation({ 
    summary: 'Consultar datos de un contribuyente en AFIP',
    description: 'Obtiene información de un contribuyente: denominación, condición IVA, domicilio, etc.'
  })
  @ApiResponse({
    status: 200,
    description: 'Datos del contribuyente obtenidos exitosamente',
    type: ResponseDto<ContribuyenteResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async consultarContribuyente(
    @Body() consultaDto: ConsultarContribuyenteDto,
  ): Promise<ResponseDto<ContribuyenteResponseDto>> {
    const datos = await this.afipService.consultarContribuyente(consultaDto);
    return new ResponseDto(datos, 'Datos del contribuyente obtenidos exitosamente');
  }

  @Post('tipos-comprobante')
  @Auditory('Consultar tipos de comprobante')
  @ApiOperation({ 
    summary: 'Obtener tipos de comprobante habilitados para el emisor',
    description: 'Lista todos los tipos de comprobante que el emisor está autorizado a emitir.'
  })
  @ApiResponse({
    status: 200,
    description: 'Tipos de comprobante obtenidos exitosamente',
    type: ResponseDto<TipoComprobanteResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async getTiposComprobante(
    @Body() paramsDto: AfipParamsRequestDto,
  ): Promise<ResponseDto<TipoComprobanteResponseDto[]>> {
    const homologacion = paramsDto.homologacion !== undefined ? paramsDto.homologacion : false;
    const tipos = await this.afipService.getTiposComprobante(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
      homologacion,
    );
    return new ResponseDto(tipos, 'Tipos de comprobante obtenidos exitosamente');
  }

  @Post('puntos-venta')
  @Auditory('Consultar puntos de venta')
  @ApiOperation({ 
    summary: 'Obtener puntos de venta habilitados para el emisor',
    description: 'Lista todos los puntos de venta habilitados para facturación electrónica.'
  })
  @ApiResponse({
    status: 200,
    description: 'Puntos de venta obtenidos exitosamente',
    type: ResponseDto<PuntoVentaResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async getPuntosVenta(
    @Body() paramsDto: AfipParamsRequestDto,
  ): Promise<ResponseDto<PuntoVentaResponseDto[]>> {
    const homologacion = paramsDto.homologacion !== undefined ? paramsDto.homologacion : false;
    const puntos = await this.afipService.getPuntosVenta(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
      homologacion,
    );
    return new ResponseDto(puntos, 'Puntos de venta obtenidos exitosamente');
  }

  @Post('condiciones-iva')
  @Auditory('Consultar condiciones IVA receptor')
  @ApiOperation({ 
    summary: 'Obtener condiciones IVA válidas para el receptor',
    description: `
Obtiene las condiciones de IVA válidas para el receptor según la clase de comprobante.

**Clases de comprobante:**
- A: Factura A, Nota de Crédito A, Nota de Débito A
- B: Factura B, Nota de Crédito B, Nota de Débito B
- C: Factura C, Nota de Crédito C, Nota de Débito C
- M: Facturas M (con retención)

Si no se especifica la clase, devuelve todas las combinaciones posibles.
    `
  })
  @ApiResponse({
    status: 200,
    description: 'Condiciones IVA obtenidas exitosamente',
    type: ResponseDto<CondicionIvaReceptorResponseDto[]>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async getCondicionesIva(
    @Body() paramsDto: CondicionesIvaRequestDto,
  ): Promise<ResponseDto<CondicionIvaReceptorResponseDto[]>> {
    const homologacion = paramsDto.homologacion !== undefined ? paramsDto.homologacion : false;
    const condiciones = await this.afipService.getCondicionesIvaReceptor(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
      paramsDto.claseComprobante,
      homologacion,
    );
    return new ResponseDto(condiciones, 'Condiciones IVA obtenidas exitosamente');
  }

  @Post('generar-qr')
  @Auditory('Generar código QR')
  @ApiOperation({ 
    summary: 'Generar datos para código QR de comprobante',
    description: `
Genera los datos necesarios para crear el código QR según RG 4291.
El QR contiene información del comprobante codificada en base64.

**URL resultante:** https://www.afip.gob.ar/fe/qr/?p={datos_base64}

Este endpoint no requiere autenticación con AFIP, solo genera los datos del QR.
    `
  })
  @ApiResponse({
    status: 200,
    description: 'Datos QR generados exitosamente',
    type: ResponseDto<QrDataDto>,
  })
  async generarQr(
    @Body() qrDto: GenerarQrRequestDto,
  ): Promise<ResponseDto<QrDataDto>> {
    // Formatear la fecha de YYYYMMDD a YYYY-MM-DD
    const fechaFormateada = `${qrDto.fecha.substring(0, 4)}-${qrDto.fecha.substring(4, 6)}-${qrDto.fecha.substring(6, 8)}`;
    
    // Estructura JSON según especificación AFIP
    const qrJson = {
      ver: 1,
      fecha: fechaFormateada,
      cuit: parseInt(qrDto.cuit),
      ptoVta: qrDto.ptoVta,
      tipoCmp: qrDto.tipoCmp,
      nroCmp: qrDto.nroCmp,
      importe: qrDto.importe,
      moneda: qrDto.moneda,
      ctz: qrDto.ctz,
      tipoDocRec: qrDto.tipoDocRec,
      nroDocRec: parseInt(qrDto.nroDocRec) || 0,
      tipoCodAut: 'E', // E = CAE
      codAut: parseInt(qrDto.cae),
    };

    // Codificar en base64 y generar URL
    const jsonString = JSON.stringify(qrJson);
    const base64Data = Buffer.from(jsonString).toString('base64');
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${base64Data}`;

    const qrData: QrDataDto = {
      ver: 1,
      fecha: fechaFormateada,
      cuit: qrDto.cuit,
      ptoVta: qrDto.ptoVta,
      tipoCmp: qrDto.tipoCmp,
      nroCmp: qrDto.nroCmp,
      importe: qrDto.importe,
      moneda: qrDto.moneda,
      ctz: qrDto.ctz,
      tipoDocRec: qrDto.tipoDocRec,
      nroDocRec: qrDto.nroDocRec,
      tipoCodAut: 'E',
      codAut: qrDto.cae,
      url: qrUrl,
    };

    return new ResponseDto(qrData, 'Datos QR generados exitosamente');
  }

  @Post('invoice/pdf')
  @Auditory('Generar factura en PDF')
  @ApiOperation({
    summary: 'Generar factura en formato PDF',
    description: `
Genera un PDF con formato estándar argentino a partir de los datos del comprobante y el CAE.

El PDF incluye:
- Encabezado con datos del emisor y letra del comprobante
- Datos del receptor
- Detalle de ítems
- Totales discriminados (IVA para Factura A/M)
- Código QR según RG 4291
- CAE y fecha de vencimiento

**No requiere autenticación con AFIP**, solo los datos del comprobante ya autorizado.
    `,
  })
  @ApiProduces('application/pdf')
  @ApiResponse({
    status: 200,
    description: 'PDF generado exitosamente',
    content: {
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Error en los datos del comprobante' })
  async generateInvoicePdf(
    @Body() dto: GenerateInvoicePdfDto,
    @Res({ passthrough: true }) res,
  ): Promise<StreamableFile> {
    const pdfBuffer = await this.invoicePdfService.generatePdf(dto);

    const pvStr = String(dto.puntoVenta).padStart(5, '0');
    const numStr = String(dto.numeroComprobante).padStart(8, '0');
    const filename = `${dto.tipoComprobante.replace(/\s+/g, '_')}_${pvStr}-${numStr}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(pdfBuffer);
  }

  @Post('invoice/pdf/batch')
  @Auditory('Generar lote de facturas en PDF')
  @ApiOperation({
    summary: 'Generar múltiples facturas en PDF (ZIP)',
    description: `
Genera un archivo ZIP con múltiples facturas en formato PDF.
Ideal para generar todas las facturas de un período a partir de los datos del emisor y una lista de comprobantes con su CAE.

Todas las facturas del lote comparten: emisor, tipo de comprobante, letra y punto de venta.
    `,
  })
  @ApiProduces('application/zip')
  @ApiResponse({
    status: 200,
    description: 'ZIP con PDFs generado exitosamente',
    content: {
      'application/zip': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async generateInvoicePdfBatch(
    @Body() dto: GenerateInvoicePdfBatchDto,
    @Res({ passthrough: true }) res,
  ): Promise<StreamableFile> {
    const zipBuffer = await this.invoicePdfService.generatePdfBatch(dto);

    const filename = `facturas_${dto.emisor.cuit}_pv${dto.puntoVenta}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(zipBuffer);
  }

  // ============================================
  // VENTANILLA ELECTRÓNICA ENDPOINTS
  // ============================================

  @Post('ve/comunicaciones')
  @Auditory('Consultar comunicaciones Ventanilla Electrónica')
  @ApiOperation({ 
    summary: 'Consultar comunicaciones de AFIP',
    description: 'Obtiene las comunicaciones oficiales de AFIP (notificaciones, intimaciones, etc.) de forma paginada.'
  })
  @ApiResponse({
    status: 200,
    description: 'Comunicaciones obtenidas exitosamente',
    type: ResponseDto<ComunicacionesPaginadasResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async consultarComunicaciones(
    @Body() dto: ConsultarComunicacionesDto,
  ): Promise<ResponseDto<ComunicacionesPaginadasResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consultarComunicaciones(
      dto.cuitRepresentada,
      dto.certificado,
      dto.clavePrivada,
      dto.filtros,
      dto.pagina || 1,
      dto.itemsPorPagina || 20,
      homologacion,
    );

    return new ResponseDto(result as ComunicacionesPaginadasResponseDto, 'Comunicaciones obtenidas exitosamente');
  }

  @Post('ve/comunicacion')
  @Auditory('Leer comunicación Ventanilla Electrónica')
  @ApiOperation({ 
    summary: 'Leer una comunicación específica',
    description: 'Obtiene el detalle completo de una comunicación incluyendo el cuerpo del mensaje y adjuntos.'
  })
  @ApiResponse({
    status: 200,
    description: 'Comunicación leída exitosamente',
    type: ResponseDto<ComunicacionDetalleResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  @ApiResponse({ status: 404, description: 'Comunicación no encontrada' })
  async consumirComunicacion(
    @Body() dto: ConsumirComunicacionDto,
  ): Promise<ResponseDto<ComunicacionDetalleResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consumirComunicacion(
      dto.cuitRepresentada,
      dto.certificado,
      dto.clavePrivada,
      dto.idComunicacion,
      dto.incluirAdjuntos || false,
      homologacion,
    );

    return new ResponseDto(result as ComunicacionDetalleResponseDto, 'Comunicación leída exitosamente');
  }

  @Post('ve/sistemas-publicadores')
  @Auditory('Consultar sistemas publicadores VE')
  @ApiOperation({ 
    summary: 'Consultar sistemas publicadores',
    description: 'Obtiene la lista de sistemas que publican comunicaciones en Ventanilla Electrónica (ARCA, DGCL, etc.)'
  })
  @ApiResponse({
    status: 200,
    description: 'Sistemas publicadores obtenidos exitosamente',
    type: ResponseDto<SistemasPublicadoresResponseDto>,
  })
  async consultarSistemasPublicadores(
    @Body() dto: ConsultarSistemasPublicadoresDto,
  ): Promise<ResponseDto<SistemasPublicadoresResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const sistemas = await this.afipService.consultarSistemasPublicadores(
      dto.cuitRepresentada,
      dto.certificado,
      dto.clavePrivada,
      dto.idSistemaPublicador,
      homologacion,
    );

    return new ResponseDto({ sistemas } as SistemasPublicadoresResponseDto, 'Sistemas publicadores obtenidos exitosamente');
  }

  @Post('ve/estados')
  @Auditory('Consultar estados de comunicación VE')
  @ApiOperation({ 
    summary: 'Consultar estados de comunicación',
    description: 'Obtiene los estados posibles para las comunicaciones (No leída, Leída, etc.)'
  })
  @ApiResponse({
    status: 200,
    description: 'Estados obtenidos exitosamente',
    type: ResponseDto<EstadosComunicacionResponseDto>,
  })
  async consultarEstadosComunicacion(
    @Body() dto: ConsultarEstadosDto,
  ): Promise<ResponseDto<EstadosComunicacionResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const estados = await this.afipService.consultarEstadosComunicacion(
      dto.cuitRepresentada,
      dto.certificado,
      dto.clavePrivada,
      homologacion,
    );

    return new ResponseDto({ estados } as EstadosComunicacionResponseDto, 'Estados obtenidos exitosamente');
  }

  // ============================================
  // WSCDC (CONSTATACIÓN DE COMPROBANTES) ENDPOINTS
  // ============================================

  @Post('wscdc/constatar')
  @Auditory('Constatar comprobante WSCDC')
  @ApiOperation({ 
    summary: 'Constatar/verificar un comprobante',
    description: 'Verifica si un comprobante existe, está autorizado y obtiene sus datos completos (CAE, fechas, importe, estado).'
  })
  @ApiResponse({
    status: 200,
    description: 'Comprobante constatado exitosamente',
    type: ResponseDto<ComprobanteConstatarResponseDto>,
  })
  @ApiResponse({ status: 400, description: 'Error en la solicitud' })
  async constatarComprobante(
    @Body() dto: ComprobanteConstatarDto,
  ): Promise<ResponseDto<ComprobanteConstatarResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.constatarComprobante(
      dto.cuitEmisor,
      dto.certificado,
      dto.clavePrivada,
      dto.puntoVenta,
      dto.tipoComprobante,
      dto.numeroComprobante,
      dto.cuitEmisorComprobante,
      homologacion,
    );

    return new ResponseDto(result as ComprobanteConstatarResponseDto, 'Comprobante constatado exitosamente');
  }

  @Post('wscdc/modalidades')
  @Auditory('Consultar modalidades de comprobante WSCDC')
  @ApiOperation({ 
    summary: 'Consultar modalidades de autorización',
    description: 'Obtiene las modalidades por las que puede ser autorizado un comprobante (CAE, CAEA, etc.)'
  })
  @ApiResponse({
    status: 200,
    description: 'Modalidades obtenidas exitosamente',
    type: ResponseDto<ModalidadResponseDto>,
  })
  async consultarModalidadesComprobante(
    @Body() dto: ComprobantesModalidadConsultarDto,
  ): Promise<ResponseDto<ModalidadResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consultarModalidadesComprobante(
      dto.cuitEmisor,
      dto.certificado,
      dto.clavePrivada,
      homologacion,
    );

    return new ResponseDto(result as ModalidadResponseDto, 'Modalidades obtenidas exitosamente');
  }

  @Post('wscdc/tipos-comprobante')
  @Auditory('Consultar tipos de comprobante WSCDC')
  @ApiOperation({ 
    summary: 'Consultar tipos de comprobante',
    description: 'Obtiene los tipos de comprobante disponibles con sus códigos y descripciones'
  })
  @ApiResponse({
    status: 200,
    description: 'Tipos de comprobante obtenidos exitosamente',
    type: ResponseDto<TipoComprobanteWscdcResponseDto>,
  })
  async consultarTiposComprobanteWscdc(
    @Body() dto: ComprobantesTipoConsultarDto,
  ): Promise<ResponseDto<TipoComprobanteWscdcResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consultarTiposComprobanteWscdc(
      dto.cuitEmisor,
      dto.certificado,
      dto.clavePrivada,
      homologacion,
    );

    return new ResponseDto(result as TipoComprobanteWscdcResponseDto, 'Tipos de comprobante obtenidos exitosamente');
  }

  @Post('wscdc/tipos-documento')
  @Auditory('Consultar tipos de documento WSCDC')
  @ApiOperation({ 
    summary: 'Consultar tipos de documento',
    description: 'Obtiene los tipos de documento disponibles (CUIT, DNI, etc.)'
  })
  @ApiResponse({
    status: 200,
    description: 'Tipos de documento obtenidos exitosamente',
    type: ResponseDto<TipoDocumentoResponseDto>,
  })
  async consultarTiposDocumento(
    @Body() dto: DocumentosTipoConsultarDto,
  ): Promise<ResponseDto<TipoDocumentoResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consultarTiposDocumento(
      dto.cuitEmisor,
      dto.certificado,
      dto.clavePrivada,
      homologacion,
    );

    return new ResponseDto(result as TipoDocumentoResponseDto, 'Tipos de documento obtenidos exitosamente');
  }

  @Post('wscdc/tipos-opcionales')
  @Auditory('Consultar tipos de datos opcionales WSCDC')
  @ApiOperation({ 
    summary: 'Consultar tipos de datos opcionales',
    description: 'Obtiene los tipos de datos opcionales disponibles (CBU, Alias, etc.)'
  })
  @ApiResponse({
    status: 200,
    description: 'Tipos opcionales obtenidos exitosamente',
    type: ResponseDto<TipoOpcionalResponseDto>,
  })
  async consultarTiposOpcionales(
    @Body() dto: OpcionalesTipoConsultarDto,
  ): Promise<ResponseDto<TipoOpcionalResponseDto>> {
    const homologacion = dto.homologacion !== undefined ? dto.homologacion : false;
    const result = await this.afipService.consultarTiposOpcionales(
      dto.cuitEmisor,
      dto.certificado,
      dto.clavePrivada,
      homologacion,
    );

    return new ResponseDto(result as TipoOpcionalResponseDto, 'Tipos opcionales obtenidos exitosamente');
  }

  @Get('wscdc/dummy')
  @Auditory('Comprobante Dummy WSCDC')
  @ApiOperation({ 
    summary: 'Verificar funcionamiento de infraestructura',
    description: 'Método Dummy para verificar el estado de los servidores (no requiere autenticación). Por defecto usa homologación.'
  })
  @ApiResponse({
    status: 200,
    description: 'Estado de infraestructura obtenido exitosamente',
    type: ResponseDto<DummyResponseDto>,
  })
  async comprobanteDummy(
    @Query('homologacion') homologacion?: string,
  ): Promise<ResponseDto<DummyResponseDto>> {
    // Convertir query param a boolean (default: true)
    const useHomologacion = homologacion === 'true';
    const result = await this.afipService.comprobanteDummy(useHomologacion);

    return new ResponseDto(result as DummyResponseDto, 'Estado de infraestructura obtenido exitosamente');
  }

  private mapCommerceInvoiceToStandard(dto: CreateCommerceInvoiceDto): CreateInvoiceDto {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Debe enviar al menos un ítem en items');
    }

    let importeNetoGravado = 0;
    let importeNetoNoGravado = 0;
    let importeExento = 0;
    const ivaMap = new Map<number, { BaseImp: number; Importe: number }>();

    for (const [index, item] of dto.items.entries()) {
      const alicuota = item.alicuotaIva ?? AlicuotaIva.IVA_21;
      const bonificacion = item.bonificacion ?? 0;
      const base = this.roundCurrency(item.cantidad * item.precioUnitario);
      const subtotal = this.roundCurrency(base - bonificacion);

      if (subtotal < 0) {
        throw new BadRequestException(
          `El ítem #${index + 1} (${item.descripcion}) tiene subtotal negativo. Verifique cantidad, precio y bonificación.`,
        );
      }

      if (alicuota === AlicuotaIva.NO_GRAVADO) {
        importeNetoNoGravado += subtotal;
        continue;
      }

      if (alicuota === AlicuotaIva.EXENTO) {
        importeExento += subtotal;
        continue;
      }

      const tasa = this.getAlicuotaPercent(alicuota);
      const importeIvaLinea = this.roundCurrency((subtotal * tasa) / 100);
      importeNetoGravado += subtotal;

      const current = ivaMap.get(alicuota) || { BaseImp: 0, Importe: 0 };
      current.BaseImp = this.roundCurrency(current.BaseImp + subtotal);
      current.Importe = this.roundCurrency(current.Importe + importeIvaLinea);
      ivaMap.set(alicuota, current);
    }

    importeNetoGravado = this.roundCurrency(importeNetoGravado);
    importeNetoNoGravado = this.roundCurrency(importeNetoNoGravado);
    importeExento = this.roundCurrency(importeExento);

    const iva = Array.from(ivaMap.entries()).map(([Id, values]) => ({
      Id,
      BaseImp: values.BaseImp,
      Importe: values.Importe,
    }));

    const importeIva = this.roundCurrency(
      iva.reduce((acc, value) => acc + value.Importe, 0),
    );
    const importeTributos = this.roundCurrency(dto.importeTributos || 0);
    const importeTotal = this.roundCurrency(
      importeNetoGravado + importeNetoNoGravado + importeExento + importeIva + importeTributos,
    );

    return {
      puntoVenta: dto.puntoVenta,
      tipoComprobante: dto.tipoComprobante,
      numeroComprobante: dto.numeroComprobante,
      fechaComprobante: dto.fechaComprobante,
      cuitCliente: dto.cuitCliente,
      tipoDocumento: dto.tipoDocumento,
      condicionIvaReceptor: dto.condicionIvaReceptor,
      concepto: dto.concepto || Concepto.PRODUCTOS,
      importeNetoGravado,
      importeNetoNoGravado,
      importeExento,
      importeIva,
      importeTributos,
      importeTotal,
      iva: iva.length > 0 ? iva : undefined,
      comprobantesAsociados: dto.comprobantesAsociados,
      monedaId: dto.monedaId,
      cotizacionMoneda: dto.cotizacionMoneda,
      fechaServicioDesde: dto.fechaServicioDesde,
      fechaServicioHasta: dto.fechaServicioHasta,
      fechaVencimientoPago: dto.fechaVencimientoPago,
      cbu: dto.cbu,
      fceVtoPago: dto.fceVtoPago,
      cuitEmisor: dto.cuitEmisor,
      certificado: dto.certificado,
      clavePrivada: dto.clavePrivada,
      homologacion: dto.homologacion,
    };
  }

  private getAlicuotaPercent(alicuota: AlicuotaIva): number {
    switch (alicuota) {
      case AlicuotaIva.IVA_27:
        return 27;
      case AlicuotaIva.IVA_21:
        return 21;
      case AlicuotaIva.IVA_10_5:
        return 10.5;
      case AlicuotaIva.IVA_5:
        return 5;
      case AlicuotaIva.IVA_2_5:
        return 2.5;
      case AlicuotaIva.IVA_0:
      case AlicuotaIva.NO_GRAVADO:
      case AlicuotaIva.EXENTO:
      default:
        return 0;
    }
  }

  private roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
