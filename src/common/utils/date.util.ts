// date.util.ts — re-exporta helpers de clock.ts para no romper imports viejos.
// Código nuevo debe importar directamente de '@/common/utils/clock'.
export { addMonths, addDays, startOfDay, startOfMonth } from './clock';

