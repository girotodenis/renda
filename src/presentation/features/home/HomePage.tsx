import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BarChart3, Download, LineChart, Plane, Receipt, Scale, Smartphone, Split, Target, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

const destaques: { icon: LucideIcon; titulo: string; descricao: string }[] = [
  {
    icon: Receipt,
    titulo: 'Operações e proventos',
    descricao:
      'Lance compras, vendas e dividendos/JCP em segundos. O histórico completo fica salvo na sua planilha.',
  },
  {
    icon: BarChart3,
    titulo: 'Dashboard inteligente',
    descricao:
      'Preço médio, lucro, alocação por ativo e categoria, e evolução patrimonial calculados automaticamente.',
  },
  {
    icon: Download,
    titulo: 'Importação da B3',
    descricao:
      'Importe extratos da Área do Investidor da B3 (movimentações, negociações e proventos) com poucos cliques.',
  },
  {
    icon: Scale,
    titulo: 'Rebalanceamento por metas',
    descricao: 'Defina metas por categoria e descubra onde aportar com o aporte inteligente.',
  },
  {
    icon: Split,
    titulo: 'Eventos corporativos',
    descricao: 'Splits, grupamentos e bonificações tratados automaticamente nos seus cálculos.',
  },
  {
    icon: Target,
    titulo: 'Alertas de valuation',
    descricao: 'Defina preço teto e margem de segurança — o app sinaliza oportunidades de compra.',
  },
  {
    icon: Smartphone,
    titulo: 'PWA instalável',
    descricao: 'Instale no celular ou computador como um app nativo, direto do navegador.',
  },
  {
    icon: Plane,
    titulo: 'Funciona offline',
    descricao:
      'Consulte tudo sem internet. Suas alterações são sincronizadas automaticamente ao reconectar.',
  },
]

export function HomePage() {
  return (
    <section className="space-y-8">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Wallet className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
              Controle de Investimentos
            </h1>
            <p className="text-sm text-slate-500">
              Sua carteira, na sua planilha do Google Sheets.
            </p>
          </div>
        </div>

        <p className="mt-4 max-w-3xl text-slate-600">
          Entre com sua conta Google e use sua própria planilha do Google Sheets como base de
          dados. Nada fica guardado com a gente: o app é só uma tela para a sua planilha — tudo
          o que você lança fica salvo na sua conta, sob seu controle.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Entrar com Google
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100"
          >
            Ver dashboard
            <LineChart className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {destaques.map(({ icon: Icon, titulo, descricao }) => (
          <div
            key={titulo}
            className="rounded-[18px] border border-slate-200 bg-white p-7 transition-all hover:-translate-y-1.5 hover:border-brand-400"
          >
            <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-50 text-brand-600">
              <Icon className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="mb-2 text-lg font-bold text-slate-900">{titulo}</h2>
            <p className="text-sm text-slate-500">{descricao}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
