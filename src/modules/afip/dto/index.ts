export * from './afip-login.dto';
export * from './afip-ticket.dto';
export * from './create-invoice.dto';
export * from './invoice-response.dto';
export * from './ultimo-autorizado.dto';
export * from './consultar-contribuyente.dto';
export * from './afip-params.dto';

// Explicit exports to help TypeScript
export { 
  CreateInvoiceDto, 
  TipoComprobante, 
  TipoDocumento, 
  CondicionIvaReceptor,
  Concepto,
  AlicuotaIva,
  IvaDto,
  ComprobanteAsociadoDto,
  CbuDto,
  getClaseComprobante,
  esNotaCreditoDebito,
  esFacturaCreditoElectronica,
  getCondicionesIvaValidas,
} from './create-invoice.dto';
export { InvoiceResponseDto, QrDataDto, ObservacionDto } from './invoice-response.dto';
export { ConsultarContribuyenteDto, ContribuyenteResponseDto } from './consultar-contribuyente.dto';
export { 
  AfipParamsRequestDto, 
  CondicionesIvaRequestDto, 
  TipoComprobanteResponseDto, 
  PuntoVentaResponseDto,
  CondicionIvaReceptorResponseDto,
  GenerarQrRequestDto,
} from './afip-params.dto';
