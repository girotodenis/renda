import { useEffect, useMemo, useState } from 'react'

/** Registros exibidos por página nas listas de lançamentos (modal do ativo). */
export const PAGE_SIZE = 10

/**
 * Estado de paginação para listas pequenas: fatia `items` em páginas de
 * `pageSize` registros e volta para a primeira página sempre que `resetKey`
 * muda (ex.: troca de ticker no modal do ativo).
 */
export function usePagination<T>(items: readonly T[], pageSize = PAGE_SIZE, resetKey?: unknown) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, totalPages)

  useEffect(() => {
    setPage(1)
  }, [resetKey])

  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  )

  return { page: current, pageItems, setPage, totalPages }
}
