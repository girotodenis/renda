/**
 * Progresso de uma operação longa disparada pelo usuário (ex.: atualização
 * manual das cotações a partir do dashboard).
 *
 * A UI consome os três campos diretamente: `etapa` é o texto exibido acima da
 * barra (ex.: "Atualizando ticker PETR4") e `atual`/`total` formam o contador
 * ("3/10"). `total === 0` indica que o total ainda é desconhecido — a barra
 * fica indeterminada até a operação saber quantos itens vai percorrer.
 */
export interface ProgressoAtualizacao {
  /** Texto do passo em execução. */
  etapa: string
  /** Itens já concluídos (0 quando o total ainda é desconhecido). */
  atual: number
  /** Total de itens da operação (`0` enquanto desconhecido). */
  total: number
}

/** Callback de progresso — opcional em todas as camadas. */
export type AoProgredir = (progresso: ProgressoAtualizacao) => void

/** Erro lançado quando o usuário cancela uma operação em andamento. */
export class AtualizacaoCanceladaError extends Error {
  constructor() {
    super('Atualização cancelada.')
    this.name = 'AtualizacaoCanceladaError'
  }
}

/** `true` quando o erro é o cancelamento do usuário (não é uma falha real). */
export function isAtualizacaoCancelada(error: unknown): boolean {
  return error instanceof AtualizacaoCanceladaError
}

/** Interrompe o fluxo quando o usuário cancelou a operação em andamento. */
export function garantirNaoCancelado(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AtualizacaoCanceladaError()
}
