import { BadRequestException } from '@nestjs/common';
import {
  CreateInvoiceDto,
  TipoComprobante,
  esFacturaCreditoElectronica,
  esNotaCreditoDebito,
  getClaseComprobante,
} from '../dto/create-invoice.dto';

/**
 * Valida reglas de negocio de Notas de Crédito/Débito antes de pegar a AFIP.
 *
 * Las reglas simples (presencia, formato) se validan en el DTO con class-validator.
 * Acá van las reglas *semánticas* que requieren múltiples campos.
 */
export class NotaCreditoValidator {
  /** Ejecuta todas las validaciones. Lanza 400 con lista de errores si hay alguno. */
  static validate(dto: CreateInvoiceDto): void {
    if (!esNotaCreditoDebito(dto.tipoComprobante)) return;

    const errors: string[] = [];

    // 1. Fecha del comprobante: N-5 y ≥ 20130101
    this.validateFecha(dto, errors);

    // 2. No repetir CbteAsoc dentro del mismo request
    this.validateCbteAsocUniqueness(dto, errors);

    // 3. Lógica de anulación: NC A anulación asocia ND A, clase debe coincidir
    this.validateClaseMatch(dto, errors);

    // 4. NC C: no debe mandar array IVA
    this.validateIvaPorClase(dto, errors);

    // 5. Reglas específicas de NC FCE (203/208/213)
    if (esFacturaCreditoElectronica(dto.tipoComprobante)) {
      this.validateFCERules(dto, errors);
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        error: 'nota_credito_invalid',
        message: `La Nota de Crédito/Débito tiene reglas violadas: ${errors.join(' | ')}`,
        violations: errors,
      });
    }
  }

  private static validateFecha(dto: CreateInvoiceDto, errors: string[]): void {
    if (!/^\d{8}$/.test(dto.fechaComprobante)) return; // formato ya validado

    const y = Number(dto.fechaComprobante.slice(0, 4));
    const m = Number(dto.fechaComprobante.slice(4, 6));
    const d = Number(dto.fechaComprobante.slice(6, 8));
    const fch = new Date(Date.UTC(y, m - 1, d));

    // >= 20130101
    const minDate = new Date(Date.UTC(2013, 0, 1));
    if (fch.getTime() < minDate.getTime()) {
      errors.push(
        `fechaComprobante no puede ser anterior al 20130101 (recibido: ${dto.fechaComprobante})`,
      );
    }

    // Hasta N-5 (puede ser 5 días atrás desde hoy)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const limite = new Date(today.getTime() - 5 * 86400_000);
    if (fch.getTime() < limite.getTime()) {
      errors.push(
        `fechaComprobante no puede ser más de 5 días anterior a hoy (N-5). Recibido: ${dto.fechaComprobante}, límite: ${this.toYYYYMMDD(limite)}`,
      );
    }

    // No futura más allá de razonable (+5 días)
    const futuro = new Date(today.getTime() + 5 * 86400_000);
    if (fch.getTime() > futuro.getTime()) {
      errors.push(
        `fechaComprobante demasiado futura (máx +5 días): ${dto.fechaComprobante}`,
      );
    }
  }

  private static validateCbteAsocUniqueness(
    dto: CreateInvoiceDto,
    errors: string[],
  ): void {
    const asocs = dto.comprobantesAsociados ?? [];
    if (asocs.length < 2) return;
    const seen = new Set<string>();
    for (const c of asocs) {
      const key = `${c.Tipo}-${c.PtoVta}-${c.Nro}`;
      if (seen.has(key)) {
        errors.push(
          `comprobantesAsociados duplicado: Tipo=${c.Tipo}, PtoVta=${c.PtoVta}, Nro=${c.Nro}`,
        );
      }
      seen.add(key);
    }
  }

  /**
   * Lógica de anulación:
   *  - NC (normal) asocia Factura/ND de la MISMA clase (A→A, B→B, C→C, FCE→FCE)
   *  - NC (anulación) asocia ND de la misma clase (A→A, B→B, C→C)
   *  - ND asocia Factura/NC de la misma clase
   * No se pueden cruzar clases A/B/C.
   */
  private static validateClaseMatch(
    dto: CreateInvoiceDto,
    errors: string[],
  ): void {
    const asocs = dto.comprobantesAsociados ?? [];
    if (asocs.length === 0) return;

    const myClase = getClaseComprobante(dto.tipoComprobante);
    for (const c of asocs) {
      const asocClase = getClaseComprobante(c.Tipo);
      if (myClase !== asocClase) {
        errors.push(
          `comprobantesAsociados[Tipo=${c.Tipo}] es clase ${asocClase}, pero el comprobante que estás emitiendo es clase ${myClase}. No se pueden cruzar clases (A con A, B con B, C con C)`,
        );
      }
    }

    // NC de anulación: debe asociar ND (no Factura ni NC)
    if (dto.esAnulacion) {
      const esNC = [
        TipoComprobante.NOTA_CREDITO_A,
        TipoComprobante.NOTA_CREDITO_B,
        TipoComprobante.NOTA_CREDITO_C,
        TipoComprobante.NOTA_CREDITO_M,
        TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_A,
        TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_B,
        TipoComprobante.NOTA_CREDITO_CREDITO_ELECTRONICA_C,
      ].includes(dto.tipoComprobante);

      if (esNC) {
        // NC de anulación asocia ND (y opcionalmente Factura según doc: "débito o factura")
        const asocTipos = asocs.map((a) => a.Tipo);
        const tiposND = new Set([2, 7, 12, 52, 202, 207, 212]);
        const tiposFactura = new Set([1, 6, 11, 51, 201, 206, 211]);
        const valid = asocTipos.every(
          (t) => tiposND.has(t) || tiposFactura.has(t),
        );
        if (!valid) {
          errors.push(
            `NC de anulación solo puede asociar ND o Factura de la misma clase. Tipos asociados: ${asocTipos.join(', ')}`,
          );
        }
      }
    }
  }

  private static validateIvaPorClase(
    dto: CreateInvoiceDto,
    errors: string[],
  ): void {
    const clase = getClaseComprobante(dto.tipoComprobante);
    // Clase C (y FCE C): no debe mandar array IVA
    if ((clase === 'C' || clase === 'FCE_C') && dto.iva && dto.iva.length > 0) {
      errors.push(
        `NC clase C no debe informar array "iva". Recibidas ${dto.iva.length} alícuotas`,
      );
    }
    // Clase C: ImpIVA debe ser 0
    if ((clase === 'C' || clase === 'FCE_C') && (dto.importeIva ?? 0) > 0) {
      errors.push(
        `NC clase C debe tener importeIva = 0. Recibido: ${dto.importeIva}`,
      );
    }
    // Clase B: ImpIVA debe ser 0 (el IVA va incluido en ImpNeto)
    if ((clase === 'B' || clase === 'FCE_B') && (dto.importeIva ?? 0) > 0) {
      errors.push(
        `NC clase B debe tener importeIva = 0 (IVA incluido en importeNetoGravado). Recibido: ${dto.importeIva}`,
      );
    }
  }

  /**
   * Reglas específicas de NC FCE (203/208/213):
   *  - No CBU/Alias ni FchVtoPago (salvo anulación para FchVtoPago)
   *  - CUIT receptor ≠ 23000000000 (No Categorizado)
   *  - Opcional 22 obligatorio (lo inyecta el service si viene esAnulacion, si no: error)
   *  - Si moneda ≠ PES, MonCotiz debe estar presente
   */
  private static validateFCERules(
    dto: CreateInvoiceDto,
    errors: string[],
  ): void {
    if (dto.cbu) {
      errors.push('NC FCE no puede informar CBU (es solo para la Factura FCE original)');
    }
    if (dto.fceVtoPago && !dto.esAnulacion) {
      errors.push('NC FCE no puede informar fceVtoPago (salvo NC de anulación)');
    }
    if (dto.cuitCliente === '23000000000') {
      errors.push(
        'NC FCE: el CUIT receptor 23000000000 (No Categorizado) no está permitido',
      );
    }

    // Opcional 22 obligatorio: o viene en opcionales[], o viene esAnulacion (service lo inyecta)
    const tiene22 = (dto.opcionales ?? []).some((o) => o.Id === 22);
    if (!tiene22 && dto.esAnulacion === undefined) {
      errors.push(
        'NC FCE: debés informar `esAnulacion` (true/false) o mandar el opcional Id=22 con valor "S"/"N"',
      );
    }
  }

  private static toYYYYMMDD(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
