import { useEffect, useState } from 'react'

/**
 * Observa o estado de conexão do navegador (RNF08).
 *
 * Usa `navigator.onLine` e os eventos `online`/`offline`. Em ambientes sem
 * `navigator` (testes/SSR) assume-se online para não bloquear a leitura remota.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
