import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { LayoutContext } from '@/presentation/app/providers/layoutContext'
import type { LayoutContextValue } from '@/presentation/app/providers/layoutContext'
import type { LayoutTema } from '@/domain/layout'
import { layoutStorage } from '@/infrastructure/storage'

interface LayoutProviderProps {
  children: ReactNode
}

/**
 * Provider do tema de layout: lê a preferência do navegador, aplica o atributo
 * `data-tema` no `<html>` (para a camada CSS trocar as cores) e persiste a
 * escolha no `LocalStorage` a cada mudança.
 */
export function LayoutProvider({ children }: LayoutProviderProps) {
  const [tema, setTemaState] = useState<LayoutTema>(() => layoutStorage.load())

  const setTema = useCallback((novo: LayoutTema) => {
    setTemaState(novo)
    layoutStorage.save(novo)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.tema = tema
  }, [tema])

  const value: LayoutContextValue = { tema, setTema }

  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}
