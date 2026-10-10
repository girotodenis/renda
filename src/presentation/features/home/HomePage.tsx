import { ArrowRight, LineChart, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'

const destaques = [
  'Lançamento de operações e proventos',
  'Cálculo automático do consolidado da carteira',
  'Dashboard com alocação e evolução patrimonial',
  'Rebalanceamento por metas e aporte inteligente',
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

      <div className="grid gap-4 sm:grid-cols-2">
        {destaques.map((item) => (
          <div key={item} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-700">{item}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
