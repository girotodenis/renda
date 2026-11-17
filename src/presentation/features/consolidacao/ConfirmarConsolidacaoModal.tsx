import { AlertTriangle, Download, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SimulacaoConsolidacao } from '@/presentation/hooks/useConsolidacao'
import { Alert } from '@/presentation/components/Alert'
import { Modal } from '@/presentation/components/Modal'
import { categoriaLabel, isRendaFixa, isTesouroDireto } from '@/domain/categoria'
import type { AlvoConsolidacao } from '@/domain/consolidacao'
import type { CategoriaAtivo } from '@/domain/entities'
import { formatarBRL, fromCentavos } from '@/domain/money'

interface ConfirmarConsolidacaoModalProps {
  aberto: boolean
  alvo: AlvoConsolidacao | null
  categoria: CategoriaAtivo | null
  simulacao: SimulacaoConsolidacao | null
  isExecutando: boolean
  isExportando: boolean
  isOffline: boolean
  onConfirmar: () => void
  onFechar: () => void
  onExportarBackup: () => void
}

/** Escopo em texto pt-BR (ticker inteiro ou ticker + ano/modo). */
function descreverAlvo(alvo: AlvoConsolidacao): string {
  if (alvo.tipo === 'ticker') return `${alvo.ticker} — ticker inteiro (posição encerrada)`
  const modo =
    alvo.modo === 'Completo'
      ? 'ano auto-contido (operações + proventos)'
      : 'somente proventos (posição em aberto no ano)'
  return `${alvo.ticker} — ano ${alvo.ano}, ${modo}`
}

/**
 * Confirmação da consolidação (§5.2): mostra com números reais o que será
 * apagado/criado, os efeitos colaterais e exige o aceite da irreversibilidade.
 * O backup `.ods` fica disponível no próprio modal.
 */
export function ConfirmarConsolidacaoModal({
  aberto,
  alvo,
  categoria,
  simulacao,
  isExecutando,
  isExportando,
  isOffline,
  onConfirmar,
  onFechar,
  onExportarBackup,
}: ConfirmarConsolidacaoModalProps) {
  const [ciente, setCiente] = useState(false)

  useEffect(() => {
    if (aberto) setCiente(false)
  }, [aberto, alvo])

  const erro = simulacao !== null && 'erro' in simulacao ? simulacao.erro : null
  const calculo = simulacao !== null && !('erro' in simulacao) ? simulacao : null

  const compras =
    calculo?.geradas.operacoes.filter((operacao) => operacao.tipo === 'Compra').length ?? 0
  const vendas =
    calculo?.geradas.operacoes.filter((operacao) => operacao.tipo === 'Venda').length ?? 0

  const categoriaManual =
    categoria !== null && (isRendaFixa(categoria) || isTesouroDireto(categoria))
  const nadaAlterado =
    calculo !== null &&
    calculo.absorvidas.operacoes.length === 0 &&
    calculo.absorvidas.proventos.length === 0

  return (
    <Modal
      open={aberto}
      onClose={onFechar}
      titulo="Confirmar consolidação"
      className="max-w-2xl"
      corpoClassName="space-y-4"
    >
      {alvo ? (
        <p className="text-sm text-slate-600">
          Escopo: <strong className="text-slate-900">{descreverAlvo(alvo)}</strong>
          {categoria ? (
            <>
              {' '}
              · Categoria: <strong className="text-slate-900">{categoriaLabel(categoria)}</strong>
            </>
          ) : null}
        </p>
      ) : null}

      {erro ? (
        <Alert variant="error" title="Não é possível consolidar">
          {erro}
        </Alert>
      ) : null}

      {calculo ? (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              Serão apagadas{' '}
              <strong className="text-slate-900">
                {calculo.absorvidas.operacoes.length} operação(ões)
              </strong>{' '}
              e{' '}
              <strong className="text-slate-900">
                {calculo.absorvidas.proventos.length} provento(s)
              </strong>
              , substituídos por <strong className="text-slate-900">{compras} compra(s)</strong>,{' '}
              <strong className="text-slate-900">{vendas} venda(s)</strong> e{' '}
              <strong className="text-slate-900">
                {calculo.geradas.proventos.length} provento(s)
              </strong>{' '}
              (1 por tipo/ano).
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Total de compras</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {formatarBRL(fromCentavos(calculo.resumo.totalCompras))}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Total de vendas</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {formatarBRL(fromCentavos(calculo.resumo.totalVendas))}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Lucro realizado</dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {formatarBRL(fromCentavos(calculo.resumo.lucroRealizado))}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">
                  Total de proventos
                </dt>
                <dd className="font-semibold tabular-nums text-slate-900">
                  {formatarBRL(fromCentavos(calculo.resumo.totalProventos))}
                </dd>
              </div>
            </dl>
          </div>

          {nadaAlterado ? (
            <Alert variant="info">
              Nada seria alterado neste escopo (não há linhas suficientes para consolidar).
            </Alert>
          ) : null}

          {categoriaManual ? (
            <Alert variant="info" title="Renda Fixa / Tesouro Direto">
              A marcação manual (<code>Valor Bruto Atual</code>), o indexador e o vencimento são
              copiados para a linha consolidada de maior data — a marcação continua sendo o preço
              de mercado.
            </Alert>
          ) : null}

          <div className="space-y-1 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Efeitos colaterais</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>O detalhe do ativo passará a mostrar 1 compra e 1 venda.</li>
              <li>
                O extrato de proventos passa a mostrar o total do ano na data do último pagamento.
              </li>
              <li>Não é um recurso para apuração mensal de imposto.</li>
              <li>
                Reimportar um extrato B3 de um período consolidado voltará a criar os lançamentos
                originais (duplicidade).
              </li>
            </ul>
          </div>
        </>
      ) : null}

      <Alert variant="error" title="Ação irreversível">
        As linhas originais são apagadas e não há “Desfazer”. Exporte um backup <code>.ods</code>{' '}
        antes de continuar.
      </Alert>

      <div>
        <button
          type="button"
          onClick={onExportarBackup}
          disabled={isExportando}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExportando ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4" aria-hidden />
          )}
          Exportar backup (.ods)
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={ciente}
          onChange={(event) => setCiente(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
        Entendi que a consolidação é irreversível
      </label>

      {isOffline ? (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Sem conexão: conecte-se para consolidar.
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={onFechar}
          disabled={isExecutando}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={!ciente || isExecutando || isOffline || erro !== null || calculo === null || nadaAlterado}
          className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isExecutando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Consolidar
        </button>
      </div>
    </Modal>
  )
}
