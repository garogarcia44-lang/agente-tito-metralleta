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

/**
 * Valores con los que arrancó Fase C (ambos en 70) — corregidos una vez, a
 * mano, con el backtest de lib/backtest.ts contra flujo histórico REAL
 * (2026-08-14, 2,184 candidatos evaluados sobre 90 tickers y ~6 semanas,
 * data/backtest-result.json):
 *
 *   swingThreshold 70 → 65. En 6 semanas reales, un umbral de 70 solo dejó
 *   pasar 1 candidato en total — el escaneo automático llevaba corriendo
 *   así todo este tiempo sin crear NINGÚN plan, lo cual coincide con lo que
 *   ya se había visto en vivo. El barrido de umbrales mostró una curva
 *   limpia y monótona (58→51%, 60→53%, 62→59%, 64→61%, 65→63%, 66→75%...),
 *   señal real, no ruido. En 65 hay 176 candidatos (122 resueltos) con
 *   63.1% de acierto — z≈2.8 frente al 50% al azar (p≈0.003). No se subió
 *   más alto (66+) a propósito: ahí el acierto sigue subiendo pero la
 *   muestra se reduce a 73/35/18/4/1 resueltos, insuficiente para confiar
 *   sin sobreajustar a pocos eventos históricos.
 *
 *   intradayThreshold se queda en 70. El backtest no pudo validarlo ni en
 *   un sentido ni en otro: no hay cadena de opciones histórica (solo la de
 *   HOY existe), así que el GEX del backtest queda fijo en "neutral" para
 *   todo candidato (sin el 60% estructural que sí tiene en vivo) — el hueco
 *   pega más fuerte en intradía, donde los vencimientos cortos dependen más
 *   de los muros reales de la cadena. Cambiarlo sin evidencia sería
 *   inventar un número, justo lo que se pidió no hacer.
 */
export const DEFAULT_SCANNER_RULES: ScannerRules = {
  intradayThreshold: 70,
  swingThreshold: 65,
};
