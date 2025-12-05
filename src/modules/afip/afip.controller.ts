import { Controller, Post, Get, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AfipService } from './afip.service';
import { AfipLoginDto, AfipTicketDto } from './dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
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
import { ResponseDto } from '@/common/dto';
import { Auditory, Public } from '@/common';

@ApiTags('AFIP')
@Controller('afip')
@Public()
export class AfipController {
  constructor(
    private readonly afipService: AfipService,
    private readonly configService: ConfigService,
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
    const invoice = await this.afipService.createInvoice(createInvoiceDto);
    return new ResponseDto(invoice, 'Factura creada exitosamente');
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
      const ticket = await this.afipService.getTicket(
        'wsfe',
        dto.certificado,
        dto.clavePrivada,
      );
      
      const cuitEmisor = dto.cuitEmisor.replace(/-/g, ''); // Remover guiones si los tiene
      
      // Consultar último autorizado
      // Si no hay comprobantes previos (primera factura), el servicio devuelve CbteNro: 0
      const ultimo = await this.afipService.getUltimoAutorizado(
        ultimoAutorizadoDto.puntoVenta,
        ultimoAutorizadoDto.tipoComprobante,
        ticket,
        cuitEmisor,
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
    const tipos = await this.afipService.getTiposComprobante(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
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
    const puntos = await this.afipService.getPuntosVenta(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
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
    const condiciones = await this.afipService.getCondicionesIvaReceptor(
      paramsDto.cuitEmisor,
      paramsDto.certificado,
      paramsDto.clavePrivada,
      paramsDto.claseComprobante,
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
}
