/**
 * Carrega um script externo uma única vez, reaproveitando a tag já existente.
 * Usado para injetar a biblioteca do Google Identity Services e o `gapi`.
 */
export function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(scriptError(src)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true'
        resolve()
      },
      { once: true },
    )
    script.addEventListener('error', () => reject(scriptError(src)), { once: true })
    document.head.appendChild(script)
  })
}

function scriptError(src: string): Error {
  return new Error(`Não foi possível carregar o script do Google: ${src}`)
}
