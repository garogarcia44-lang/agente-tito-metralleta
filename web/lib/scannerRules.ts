// Reglas activas del escaneo automático (Fase C) — hoy solo los umbrales de
// score, que son lo único que el ciclo de mejora (lib/ruleProposals.ts) sabe
// proponer ajustar. Fuente única de verdad de los valores por defecto: antes
// vivían como constantes sueltas en intradayScore.ts/swingScore.ts, ahora esos
// módulos los importan de acá para que exista un solo lugar que decir "así
// arrancó el sistema".

export interface ScannerRules {
  intradayThreshold: number;
  swingThreshold: number;
}

/** Valores con los que arrancó Fase C, antes de cualquier ciclo de mejora. */
export const DEFAULT_SCANNER_RULES: ScannerRules = {
  intradayThreshold: 70,
  swingThreshold: 70,
};
