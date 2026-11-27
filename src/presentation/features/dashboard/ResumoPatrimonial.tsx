import { ArrowLeftRight, PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'
import { formatarDataBR } from '@/domain/dates'
import type { Desempenho } from '@/domain/performance'
import type { ResumoResultado } from '@/domain/resultado'
import {
  classeValor,
  formatarCentavos,
  formatarPercentual,
} from '@/presentation/features/dashboard/formatters'

interface ResumoPatrimonialProps {
  resultado: ResumoResultado
  /** XIRR (dinheiro) e TWR (tempo) da carteira. */
  desempenho: Desempenho
}

/**
 * Resumo patrimonial (RF07) em **retorno total**:
 *
 * `Retorno Total = variação de preço + lucro realizado + proventos`
 *
 * Os cartões mostram os componentes separados (patrimônio, custo, proventos,
 * variação, realizado) e o retorno total com o percentual sobre o capital
 * aportado — evitando a leitura enganosa de olhar só a variação de preço.
 */
export function ResumoPatrimonial({ resultado, desempenho }: ResumoPatrimonialProps) {
  const retornoPositivo = resultado.retornoTotal >= 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Cartao
        titulo="Patrimônio Total"
        valor={formatarCentavos(resultado.patrimonioTotal)}
        detalhe="Valor atual das posições abertas"
        icone={<Wallet className="h-4 w-4" aria-hidden />}
        destaque="neutro"
      />
      <Cartao
        titulo="Total Investido"
        valor={formatarCentavos(resultado.totalInvestido)}
        detalhe="Custo das posições abertas"
        icone={<PiggyBank className="h-4 w-4" aria-hidden />}
        destaque="neutro"
      />
      <Cartao
        titulo="Proventos Recebidos"
        valor={formatarCentavos(resultado.proventos)}
        detalhe="Dividendos, JCP e rendimentos creditados"
        icone={<PiggyBank className="h-4 w-4" aria-hidden />}
        destaque="neutro"
      />
      <Cartao
        titulo="Variação de Preço"
        valor={formatarCentavos(resultado.variacaoPreco)}
        secundario={formatarPercentual(resultado.rentabilidadePrecoPercent)}
        detalhe={`Sobre o custo das posições (${formatarCentavos(resultado.totalInvestido)})`}
        icone={
          resultado.variacaoPreco >= 0 ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )
        }
        destaque={resultado.variacaoPreco}
      />
      <Cartao
        titulo="Resultado Realizado"
        valor={formatarCentavos(resultado.lucroRealizado)}
        detalhe="Vendas, líquido de taxas"
        icone={<ArrowLeftRight className="h-4 w-4" aria-hidden />}
        destaque={resultado.lucroRealizado}
      />
      <Cartao
        titulo="Retorno Total"
        valor={formatarPercentual(resultado.rentabilidadeTotalPercent)}
        secundario={formatarCentavos(resultado.retornoTotal)}
        detalhe={`Preço + realizado + proventos ÷ capital aportado (${formatarCentavos(resultado.capitalAportado)})`}
        icone={
          retornoPositivo ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )
        }
        destaque={resultado.retornoTotal}
      />
      <Cartao
        titulo="XIRR (a.a.)"
        valor={desempenho.xirr === null ? '—' : formatarPercentual(desempenho.xirr * 100)}
        detalhe="Retorno do dinheiro, com a data de cada aporte"
        icone={<TrendingUp className="h-4 w-4" aria-hidden />}
        destaque={desempenho.xirr ?? 'neutro'}
      />
      <Cartao
        titulo="TWR do período"
        valor={desempenho.twr === null ? '—' : formatarPercentual(desempenho.twr * 100)}
        secundario={
          desempenho.twrAnualizado === null
            ? undefined
            : `${formatarPercentual(desempenho.twrAnualizado * 100)} a.a.`
        }
        detalhe={
          desempenho.inicio === null
            ? 'Sem histórico suficiente'
            : `Desempenho dos ativos desde ${formatarDataBR(desempenho.inicio)}`
        }
        icone={<TrendingUp className="h-4 w-4" aria-hidden />}
        destaque={desempenho.twr ?? 'neutro'}
      />
    </div>
  )
}

interface CartaoProps {
  titulo: string
  valor: string
  /** Valor complementar exibido ao lado (ex.: percentual do mesmo indicador). */
  secundario?: string
  detalhe: string
  icone: ReactNode
  /** Valor numérico para colorir (positivo/negativo); `'neutro'` = cor padrão. */
  destaque: number | 'neutro'
}

function Cartao({ titulo, valor, secundario, detalhe, icone, destaque }: CartaoProps) {
  const colorido = destaque !== 'neutro'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icone}
        <p className="text-xs font-semibold uppercase tracking-wide">{titulo}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <p
          className={cn(
            'text-xl font-semibold tabular-nums',
            colorido ? classeValor(destaque) : 'text-slate-900',
          )}
        >
          {valor}
        </p>
        {secundario ? (
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              destaque === 'neutro' ? 'text-slate-600' : classeValor(destaque),
            )}
          >
            {secundario}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-slate-500">{detalhe}</p>
    </div>
  )
}
