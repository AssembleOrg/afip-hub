import { DateTime } from 'luxon';

/**
 * Capa de tiempo con zona **America/Argentina/Buenos_Aires (GMT-3)**.
 *
 * Reglas del proyecto:
 *  - DB guarda siempre UTC (Postgres/Prisma default) — NO tocar eso.
 *  - Cálculos de negocio (inicio/fin de ciclo, próximo run de un cron) se
 *    hacen en GMT-3 para que "1 del mes a las 00:00" signifique lo esperado
 *    por el usuario argentino.
 *  - Formateo para UI/emails/logs user-facing: siempre GMT-3.
 *
 * Usá estas helpers — **no** uses `new Date()` directo en lógica de negocio.
 */
export const APP_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** DateTime actual en GMT-3. */
export function now(): DateTime {
  return DateTime.now().setZone(APP_TIMEZONE);
}

/** Pasa un Date (UTC en DB) a DateTime GMT-3 para mostrar/calcular. */
export function toAppZone(input: Date | string): DateTime {
  if (input instanceof Date) return DateTime.fromJSDate(input).setZone(APP_TIMEZONE);
  return DateTime.fromISO(input).setZone(APP_TIMEZONE);
}

/** Convierte DateTime (GMT-3) a Date JS UTC para persistir en DB. */
export function toDbDate(dt: DateTime): Date {
  return dt.toUTC().toJSDate();
}

/**
 * Suma meses respetando límites naturales (31-ene + 1 mes = 28/29-feb, no 3-mar).
 * Devuelve Date JS UTC listo para guardar.
 */
export function addMonths(from: Date | DateTime, months: number): Date {
  const dt = from instanceof Date ? toAppZone(from) : from;
  return toDbDate(dt.plus({ months }));
}

/** Suma días respetando DST (inexistente en ARG pero sano por si cambia). */
export function addDays(from: Date | DateTime, days: number): Date {
  const dt = from instanceof Date ? toAppZone(from) : from;
  return toDbDate(dt.plus({ days }));
}

/** Inicio del día en GMT-3 → Date UTC. */
export function startOfDay(date: Date | DateTime = now()): Date {
  const dt = date instanceof Date ? toAppZone(date) : date;
  return toDbDate(dt.startOf('day'));
}

/** Inicio del mes en GMT-3 → Date UTC. */
export function startOfMonth(date: Date | DateTime = now()): Date {
  const dt = date instanceof Date ? toAppZone(date) : date;
  return toDbDate(dt.startOf('month'));
}

/** Formato estándar para emails/UI — "dd/MM/yyyy HH:mm" en GMT-3. */
export function formatLocal(
  date: Date | DateTime | null | undefined,
  fmt: 'date' | 'datetime' | 'long' = 'datetime',
): string {
  if (!date) return '';
  const dt = date instanceof Date ? toAppZone(date) : date;
  switch (fmt) {
    case 'date':
      return dt.toFormat('dd/MM/yyyy');
    case 'long':
      return dt.setLocale('es-AR').toLocaleString(DateTime.DATETIME_FULL);
    case 'datetime':
    default:
      return dt.toFormat('dd/MM/yyyy HH:mm');
  }
}

/** Formato AFIP YYYYMMDD (para WSFE). */
export function toAfipDate(date: Date | DateTime): string {
  const dt = date instanceof Date ? toAppZone(date) : date;
  return dt.toFormat('yyyyMMdd');
}

/** Parsea YYYYMMDD (AFIP) a Date UTC (00:00 GMT-3). */
export function fromAfipDate(s: string): Date | null {
  const dt = DateTime.fromFormat(s, 'yyyyMMdd', { zone: APP_TIMEZONE });
  if (!dt.isValid) return null;
  return toDbDate(dt);
}
