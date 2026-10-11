import { PiggyBank, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/presentation/cn'
import type { ResumoCarteira } from '@/domain/consolidado'
import {
  classeValor,
  formatarCentavos,
  formatarPercentual,
} from '@/presentation/features/dashboard/formatters'

interface ResumoPatrimonialProps {
  resumo: ResumoCarteira
}

/**
 * Resumo patrimonial (RF07): patrimônio total, total investido, lucro/prejuízo
 * geral e rentabilidade percentual — a partir do consolidado (Seção 5.1).
 */
export function ResumoPatrimonial({ resumo }: ResumoPatrimonialProps) {
  const lucroPositivo = resumo.lucroTotal >= 0

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Cartao
        titulo="Patrimônio Total"
        valor={formatarCentavos(resumo.patrimonioTotal)}
        detalhe="Valor atual da carteira"
        icone={<Wallet className="h-4 w-4" aria-hidden />}
        destaque="neutro"
      />
      <Cartao
        titulo="Total Investido"
        valor={formatarCentavos(resumo.totalInvestido)}
        detalhe="Custo das posições abertas"
        icone={<PiggyBank className="h-4 w-4" aria-hidden />}
        destaque="neutro"
      />
      <Cartao
        titulo="Lucro / Prejuízo"
        valor={formatarCentavos(resumo.lucroTotal)}
        detalhe="Resultado não realizado"
        icone={
          lucroPositivo ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )
        }
        destaque={resumo.lucroTotal}
      />
      <Cartao
        titulo="Rentabilidade"
        valor={formatarPercentual(resumo.rentabilidadePercent)}
        detalhe="Sobre o total investido"
        icone={
          lucroPositivo ? (
            <TrendingUp className="h-4 w-4" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4" aria-hidden />
          )
        }
        destaque={resumo.rentabilidadePercent}
      />
    </div>
  )
}

interface CartaoProps {
  titulo: string
  valor: string
  detalhe: string
  icone: ReactNode
  /** Valor numérico para colorir (positivo/negativo); `'neutro'` = cor padrão. */
  destaque: number | 'neutro'
}

function Cartao({ titulo, valor, detalhe, icone, destaque }: CartaoProps) {
  const colorido = destaque !== 'neutro'

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        {icone}
        <p className="text-xs font-semibold uppercase tracking-wide">{titulo}</p>
      </div>
      <p
        className={cn(
          'mt-2 text-xl font-semibold tabular-nums',
          colorido ? classeValor(destaque) : 'text-slate-900',
        )}
      >
        {valor}
      </p>
      <p className="mt-1 text-xs text-slate-500">{detalhe}</p>
    </div>
  )
}
