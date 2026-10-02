import { computeOverage } from './overage';

const plan = { requestsLimit: 100, pdfLimit: 10, overagePriceUsd: 0.05, pdfOveragePriceUsd: 0.1 };

describe('computeOverage', () => {
  it('no hay excedente dentro del cupo', () => {
    expect(computeOverage(plan, { billableCount: 100, pdfCount: 10 })).toEqual({
      comprobantes: 0,
      pdfs: 0,
      usd: 0,
    });
  });

  it('cobra cada comprobante y PDF por encima del cupo', () => {
    expect(computeOverage(plan, { billableCount: 130, pdfCount: 15 })).toEqual({
      comprobantes: 30,
      pdfs: 5,
      usd: 2,
    });
  });

  it('sin precio de excedente no cobra aunque se pase (plan Free)', () => {
    const free = { ...plan, overagePriceUsd: 0, pdfOveragePriceUsd: 0 };
    expect(computeOverage(free, { billableCount: 500, pdfCount: 50 }).usd).toBe(0);
  });

  it('redondea a centavos', () => {
    const p = { ...plan, overagePriceUsd: 0.0033 };
    expect(computeOverage(p, { billableCount: 103, pdfCount: 0 }).usd).toBe(0.01);
  });
});
