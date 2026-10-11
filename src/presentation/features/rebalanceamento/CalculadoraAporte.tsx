import { AlertTriangle, Calculator } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FormField, inputClassName } from '@/presentation/components/FormField'
import { cn } from '@/presentation/cn'
import { formatarBRL, fromCentavos, parseBRL, toCentavos } from '@/domain/money'
import { aporteInteligente, rebalanceamentoCompleto, AVISO_IR_VENDAS } from '@/domain/rebalanceamento'
import type { Carteira, ItemAporte, MetasPorTicker, PrecoTeto } from '@/domain/rebalanceamento'
import { formatarCentavos } from '@/presentation/features/dashboard/formatters'

type Modo = 'aporte' | 'completo'

interface CalculadoraAporteProps {
  carteira: Carteira
  metas: MetasPorTicker
  precoTeto: PrecoTeto
}

function totalAlocado(itens: readonly ItemAporte[]): number {
  return itens.reduce((acc, item) => acc + item.valorAlocado, 0)
}

function ResultadoTabela({ titulo, itens }: { titulo: string; itens: readonly ItemAporte[] }) {
  if (itens.length === 0) {
    return (
      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-700">{titulo}</h4>
        <p className="text-sm text-slate-500">Nenhuma sugestão.</p>
      </div>
    )
  }

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-slate-700">{titulo}</h4>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Ticker</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Quantidade</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Valor</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.ticker} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono font-medium text-slate-900">{item.ticker}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {item.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatarCentavos(item.valorAlocado)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50">
              <td className="px-3 py-2 font-semibold text-slate-700" colSpan={2}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                {formatarCentavos(totalAlocado(itens))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Calculadora de aporte/reequilíbrio (RF14/RF15).
 *
 * Modo **apenas aportes** (padrão): distribui o valor entre os ativos
 * subalocados sem gerar vendas. Modo **rebalanceamento completo**: sugere
 * compras e vendas para reequilibrar integralmente — sempre com aviso de IR.
 */
export function CalculadoraAporte({ carteira, metas, precoTeto }: CalculadoraAporteProps) {
  const [valor, setValor] = useState('')
  const [modo, setModo] = useState<Modo>('aporte')
  const [usarLote, setUsarLote] = useState(false)
  const [permitirFracionario, setPermitirFracionario] = useState(false)

  const aporteCentavos = useMemo(() => {
    const parsed = parseBRL(valor)
    return parsed !== null ? Math.max(0, toCentavos(parsed)) : 0
  }, [valor])

  const resultadoAporte = useMemo(
    () =>
      aporteInteligente(carteira, metas, aporteCentavos, precoTeto, {
        lote: usarLote ? 100 : 1,
        permitirFracionario,
      }),
    [carteira, metas, aporteCentavos, precoTeto, usarLote, permitirFracionario],
  )

  const resultadoCompleto = useMemo(
    () => rebalanceamentoCompleto(carteira, metas),
    [carteira, metas],
  )

  const aporteValido = aporteCentavos > 0

  return (
    <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Calculator className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Calculadora de aporte</h2>
          <p className="text-sm text-slate-500">
            Informe um valor e veja onde investir para aproximar a carteira das metas.
          </p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <FormField
          htmlFor="aporte-valor"
          label="Valor do aporte (R$)"
          hint="Deixe em branco para simular apenas o rebalanceamento completo."
        >
          <input
            id="aporte-valor"
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            value={valor}
            onChange={(event) => setValor(event.target.value)}
            className={inputClassName}
          />
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Modo de operação</legend>
          <div className="flex flex-wrap gap-2">
            <label
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                modo === 'aporte'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <input
                type="radio"
                name="modo-rebalanceamento"
                value="aporte"
                checked={modo === 'aporte'}
                onChange={() => setModo('aporte')}
                className="accent-brand-600"
              />
              Apenas aportes
            </label>
            <label
              className={cn(
                'inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                modo === 'completo'
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <input
                type="radio"
                name="modo-rebalanceamento"
                value="completo"
                checked={modo === 'completo'}
                onChange={() => setModo('completo')}
                className="accent-brand-600"
              />
              Rebalanceamento completo
            </label>
          </div>

          {modo === 'aporte' ? (
            <div className="flex flex-wrap gap-4 pt-1 text-sm text-slate-600">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={usarLote}
                  onChange={(event) => setUsarLote(event.target.checked)}
                  className="accent-brand-600"
                />
                Respeitar lote de 100
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permitirFracionario}
                  onChange={(event) => setPermitirFracionario(event.target.checked)}
                  className="accent-brand-600"
                />
                Permitir fracionário
              </label>
            </div>
          ) : null}
        </fieldset>
      </div>

      {modo === 'completo' ? (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">Atenção: vendas geram imposto de renda</p>
            <p>{AVISO_IR_VENDAS}</p>
          </div>
        </div>
      ) : null}

      {modo === 'aporte' ? (
        <div className="space-y-3">
          <ResultadoTabela titulo="Compras sugeridas" itens={resultadoAporte} />
          {aporteValido && resultadoAporte.resto > 0 ? (
            <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              Não foi possível alocar <strong>{formatarBRL(fromCentavos(resultadoAporte.resto))}</strong>{' '}
              (abaixo do preço de 1 cota dos ativos elegíveis). Valor não alocado informado ao
              usuário.
            </p>
          ) : null}
          {!aporteValido ? (
            <p className="text-sm text-slate-500">
              Informe um valor de aporte para ver as compras sugeridas.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <ResultadoTabela titulo="Compras sugeridas" itens={resultadoCompleto.compras} />
          <ResultadoTabela titulo="Vendas sugeridas" itens={resultadoCompleto.vendas} />
        </div>
      )}
    </section>
  )
}
