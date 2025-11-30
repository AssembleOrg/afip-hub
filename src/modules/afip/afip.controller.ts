import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AfipService } from './afip.service';
import { AfipLoginDto, AfipTicketDto } from './dto';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import { UltimoAutorizadoDto, UltimoAutorizadoResponseDto } from './dto/ultimo-autorizado.dto';
import { ResponseDto } from '@/common/dto';
import { Auditory, Public } from '@/common';

@ApiTags('AFIP')
@Controller('afip')
@Public()
export class AfipController {
  constructor(private readonly afipService: AfipService) {}

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
  @ApiOperation({ summary: 'Crear factura electrónica en AFIP' })
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
  @ApiOperation({ summary: 'Obtener el último comprobante autorizado para un punto de venta y tipo' })
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
}

