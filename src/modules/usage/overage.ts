// Cálculo puro del excedente del ciclo (sin dependencias, testeable).

export interface CurrentOverage {
  comprobantes: number;
  pdfs: number;
  usd: number;
}

export function computeOverage(
  plan: {
    requestsLimit: number;
    pdfLimit: number;
    overagePriceUsd: number;
    pdfOveragePriceUsd: number;
  },
  usage: { billableCount: number; pdfCount: number },
): CurrentOverage {
  const comprobantes =
    plan.overagePriceUsd > 0 ? Math.max(0, usage.billableCount - plan.requestsLimit) : 0;
  const pdfs = plan.pdfOveragePriceUsd > 0 ? Math.max(0, usage.pdfCount - plan.pdfLimit) : 0;
  const usd = comprobantes * plan.overagePriceUsd + pdfs * plan.pdfOveragePriceUsd;
  return { comprobantes, pdfs, usd: Math.round(usd * 100) / 100 };
}
