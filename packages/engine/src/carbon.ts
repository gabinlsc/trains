/**
 * Bilan carbone de l'exploitation : émissions évitées par le report de la
 * voiture vers le train. Facteurs d'émission en kg CO₂e par
 * voyageur-kilomètre, ordres de grandeur de la Base Empreinte de l'ADEME
 * (France, 2024) : le train électrique profite d'une électricité très
 * décarbonée.
 */
import type { Traction } from '@trains/shared';

export const EMISSIONS_KG_PER_PKM = {
  car: 0.13,
  electric: 0.005,
  diesel: 0.08,
  // Un bimode roule surtout sous caténaire sur les lignes qui en ont.
  bimode: 0.04,
} as const;

/** Émissions évitées (t CO₂e) par des voyageurs-kilomètres reportés de la voiture. */
export function avoidedEmissionsT(passengerKm: number, traction: Traction): number {
  return (passengerKm * (EMISSIONS_KG_PER_PKM.car - EMISSIONS_KG_PER_PKM[traction])) / 1000;
}
