const millions = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const billions = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Montant en M€, affiché en Md€ au-delà du milliard. */
export function formatMoney(millionsOfEuros: number): string {
  return Math.abs(millionsOfEuros) >= 1000
    ? `${billions.format(millionsOfEuros / 1000)} Md€`
    : `${millions.format(millionsOfEuros)} M€`;
}
