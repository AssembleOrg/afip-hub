import { BadRequestException } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { DateTime } from 'luxon';
import { APP_TIMEZONE } from '@/common/utils/clock';

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ScheduleBuilder {
  /** "once" requiere `runOnce`; el resto requieren cron o combinación friendly */
  frequency: Frequency;
  /** Para "once": ISO date. */
  runOnce?: string;
  /** Hora local (0-23) */
  hour?: number;
  /** Minuto (0-59) */
  minute?: number;
  /** Para "weekly": días de la semana (0=domingo, 1=lunes, ..., 6=sábado). */
  daysOfWeek?: number[];
  /** Para "monthly": día del mes (1-31). Si >28, en meses cortos cae al último día. */
  dayOfMonth?: number;
  /** Para "yearly": mes 1-12. */
  month?: number;
  /** Override: cron expression directa (power user). Si viene, se ignora lo demás. */
  cronExpression?: string;
  /** Timezone (default America/Argentina/Buenos_Aires). */
  timezone?: string;
}

export interface BuiltSchedule {
  cronExpression: string;
  timezone: string;
  runOnce: Date | null;
  nextRunAt: Date;
}

/**
 * Construye una cron expression a partir del input UI-friendly, y calcula el
 * próximo `nextRunAt` en el timezone correcto. Usa Luxon para interpretar
 * runOnce (convertir la fecha local del user a UTC para guardar en DB).
 */
export function buildSchedule(input: ScheduleBuilder): BuiltSchedule {
  const tz = input.timezone || APP_TIMEZONE;

  // Caso "una sola vez": no usamos cron, solo runOnce.
  if (input.frequency === 'once') {
    if (!input.runOnce) {
      throw new BadRequestException('frequency=once requiere runOnce (ISO date)');
    }
    const dt = DateTime.fromISO(input.runOnce, { zone: tz });
    if (!dt.isValid) {
      throw new BadRequestException(`runOnce no es una fecha válida: ${input.runOnce}`);
    }
    if (dt.toMillis() <= Date.now()) {
      throw new BadRequestException('runOnce debe ser una fecha futura');
    }
    return {
      cronExpression: '0 0 1 1 *', // dummy cron que nunca usaremos, el worker mira runOnce
      timezone: tz,
      runOnce: dt.toUTC().toJSDate(),
      nextRunAt: dt.toUTC().toJSDate(),
    };
  }

  // Override directo: cron expression power-user.
  const cron = input.cronExpression?.trim() || buildCronFromFriendly(input);
  validateCron(cron);

  const nextRun = computeNext(cron, tz);
  return {
    cronExpression: cron,
    timezone: tz,
    runOnce: null,
    nextRunAt: nextRun,
  };
}

function buildCronFromFriendly(input: ScheduleBuilder): string {
  const minute = isValidInt(input.minute, 0, 59) ? input.minute! : 0;
  const hour = isValidInt(input.hour, 0, 23) ? input.hour! : 9;

  switch (input.frequency) {
    case 'daily':
      return `${minute} ${hour} * * *`;

    case 'weekly': {
      const dows = input.daysOfWeek?.filter((d) => isValidInt(d, 0, 6)) ?? [];
      if (dows.length === 0) {
        throw new BadRequestException(
          'frequency=weekly requiere daysOfWeek (0=domingo .. 6=sábado)',
        );
      }
      return `${minute} ${hour} * * ${dows.sort((a, b) => a - b).join(',')}`;
    }

    case 'monthly': {
      const dom = isValidInt(input.dayOfMonth, 1, 31) ? input.dayOfMonth! : 1;
      return `${minute} ${hour} ${dom} * *`;
    }

    case 'yearly': {
      const dom = isValidInt(input.dayOfMonth, 1, 31) ? input.dayOfMonth! : 1;
      const mon = isValidInt(input.month, 1, 12) ? input.month! : 1;
      return `${minute} ${hour} ${dom} ${mon} *`;
    }

    default:
      throw new BadRequestException(`frequency="${input.frequency}" no soportada`);
  }
}

function validateCron(expr: string): void {
  try {
    CronExpressionParser.parse(expr);
  } catch (err) {
    throw new BadRequestException(
      `cronExpression inválida: ${expr} (${(err as Error).message})`,
    );
  }
}

/** Próximo "tick" de un cron en un timezone específico. */
export function computeNext(cronExpression: string, timezone: string): Date {
  const iter = CronExpressionParser.parse(cronExpression, {
    tz: timezone,
    currentDate: new Date(),
  });
  return iter.next().toDate();
}

/** Calcula las N próximas ejecuciones (para preview en UI). */
export function previewRuns(
  cronExpression: string,
  timezone: string,
  n = 3,
): Date[] {
  const iter = CronExpressionParser.parse(cronExpression, { tz: timezone });
  const out: Date[] = [];
  for (let i = 0; i < n; i++) out.push(iter.next().toDate());
  return out;
}

function isValidInt(
  v: number | undefined,
  min: number,
  max: number,
): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}
