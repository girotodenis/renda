/**
 * Módulo **puro** de rebalanceamento (Seções 5.2–5.7 / RF12–RF17).
 *
 * Toda a lógica de metas, aporte e desvios vive aqui — sem dependência de UI ou
 * rede — e é coberta por testes unitários (`*.test.ts`).
 */

export type {
  AporteOpcoes,
  AporteResult,
  Carteira,
  ConfiguracaoMetas,
  DesvioAtivo,
  ItemAporte,
  ItemMetaConfig,
  MetaInput,
  MetasPorTicker,
  PrecoTeto,
  RebalanceamentoCompleto,
  SituacaoDesvio,
} from './types'

export { CLASSE_MARKER, converterNotasEmMetas, isLinhaDeClasse, normalizarMetas } from './metas'
export { aporteInteligente } from './aporte'
export { AVISO_IR_VENDAS, rebalanceamentoCompleto } from './completo'
export { TOLERANCIA_DESVIO_PERCENT, calcularDesvios } from './desvios'
export type { CalcularDesviosOpcoes } from './desvios'
export { montarMetaInputs, precoTetoDeConfig, tickersSomenteNaConfig, completarConfigComCarteira } from './config'
