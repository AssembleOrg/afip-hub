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
  usage: { billableCount: number; pdfCount: number; bonusCount?: number },
): CurrentOverage {
  // Los comprobantes de regalo amplían el cupo del ciclo.
  const cupo = plan.requestsLimit + (usage.bonusCount ?? 0);
  const comprobantes =
    plan.overagePriceUsd > 0 ? Math.max(0, usage.billableCount - cupo) : 0;
  const pdfs = plan.pdfOveragePriceUsd > 0 ? Math.max(0, usage.pdfCount - plan.pdfLimit) : 0;
  const usd = comprobantes * plan.overagePriceUsd + pdfs * plan.pdfOveragePriceUsd;
  return { comprobantes, pdfs, usd: Math.round(usd * 100) / 100 };
}
