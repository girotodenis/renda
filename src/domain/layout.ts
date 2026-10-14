/**
 * Temas de layout do app (selecionável na tela de Configurações).
 *
 * O tema é uma preferência de UI por navegador (persistida no `LocalStorage`,
 * nunca na planilha): dois temas iniciais — `Padrao` (o visual atual) e
 * `Propaganda` (visual inspirado na tela de propaganda, incluindo as cores).
 */

export const LayoutTema = {
  Padrao: 'padrao',
  Propaganda: 'propaganda',
} as const

export type LayoutTema = (typeof LayoutTema)[keyof typeof LayoutTema]

/** Opções ordenadas para exibição na UI. */
export const LAYOUT_TEMAS = [LayoutTema.Padrao, LayoutTema.Propaganda] as const

/** Rótulo legível de cada tema. */
export const LAYOUT_TEMA_LABELS: Record<LayoutTema, string> = {
  [LayoutTema.Padrao]: 'Claro',
  [LayoutTema.Propaganda]: 'Escuro',
}

/** Normaliza um valor persistido em `LayoutTema` (qualquer outro → `Padrao`). */
export function parseLayoutTema(valor: unknown): LayoutTema {
  return valor === LayoutTema.Propaganda ? LayoutTema.Propaganda : LayoutTema.Padrao
}
