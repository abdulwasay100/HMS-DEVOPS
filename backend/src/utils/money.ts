/** Round to 2 decimals, avoiding floating-point artifacts (e.g. 1.005 -> 1.01). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

export interface Totals {
  subtotal: number;
  discount: number;
  taxRate: number;
  tax: number;
  total: number;
}

/** discount is applied before tax. */
export function computeTotals(subtotal: number, discount: number, taxRatePercent: number): Totals {
  const sub = round2(subtotal);
  const disc = round2(Math.min(Math.max(discount, 0), sub));
  const tax = round2(((sub - disc) * taxRatePercent) / 100);
  return { subtotal: sub, discount: disc, taxRate: taxRatePercent, tax, total: round2(sub - disc + tax) };
}
