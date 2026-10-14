import { createContext, useContext } from 'react'
import type { LayoutTema } from '@/domain/layout'

/** Contexto do tema de layout selecionado pelo usuário. */
export interface LayoutContextValue {
  /** Tema atual (normalizado). */
  tema: LayoutTema
  /** Troca o tema e persiste a preferência no navegador. */
  setTema: (tema: LayoutTema) => void
}

export const LayoutContext = createContext<LayoutContextValue | null>(null)

/** Hook de acesso ao tema de layout. */
export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext)
  if (!context) {
    throw new Error('useLayout deve ser usado dentro de <LayoutProvider>.')
  }
  return context
}
