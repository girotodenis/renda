/**
 * Parser de CSV mínimo e tolerante (sem dependências externas).
 *
 * Suporta o dialeto dos extratos da B3 (Área do Investidor):
 * - Delimitador `,`; campos entre aspas `"..."` com vírgulas/acentos internos.
 * - Aspas duplicadas `""` como escape dentro de campos.
 * - Quebras de linha `\r\n` ou `\n`; BOM `\uFEFF` no início é ignorado.
 *
 * Retorna uma matriz de linhas × colunas com os valores **crus** (sem trim).
 */
export function parseCsv(texto: string): string[][] {
  let fonte = texto
  if (fonte.charCodeAt(0) === 0xfeff) fonte = fonte.slice(1)

  const linhas: string[][] = []
  let linha: string[] = []
  let campo = ''
  let emAspas = false
  let i = 0

  const finalizarCampo = (): void => {
    linha.push(campo)
    campo = ''
  }
  const finalizarLinha = (): void => {
    finalizarCampo()
    linhas.push(linha)
    linha = []
  }

  while (i < fonte.length) {
    const c = fonte[i]
    if (emAspas) {
      if (c === '"') {
        if (fonte[i + 1] === '"') {
          campo += '"'
          i += 2
          continue
        }
        emAspas = false
        i += 1
        continue
      }
      campo += c
      i += 1
      continue
    }

    if (c === '"') {
      emAspas = true
      i += 1
      continue
    }
    if (c === ',') {
      finalizarCampo()
      i += 1
      continue
    }
    if (c === '\n') {
      finalizarLinha()
      i += 1
      continue
    }
    if (c === '\r') {
      i += 1
      continue
    }
    campo += c
    i += 1
  }

  if (campo.length > 0 || linha.length > 0) finalizarLinha()

  return linhas
}
