import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, Ref } from 'react'
import { inputClassName } from '@/presentation/components/FormField'
import { cn } from '@/presentation/cn'

interface AutocompleteProps {
  /** Texto atual (controlado). */
  value: string
  /** Notifica a digitação ou a escolha de uma sugestão. */
  onChange: (value: string) => void
  /** Sugestões disponíveis (ex.: tickers conhecidos). */
  options: readonly string[]
  /** `id` do input (permite associar um `<label htmlFor>`). */
  id?: string
  placeholder?: string
  className?: string
  /** Rótulo da opção que limpa o filtro (ex.: "Todos os tickers"). */
  clearLabel?: string
  /** Nome acessível quando não há `<label>` visível. */
  ariaLabel?: string
  /** Quantidade máxima de sugestões exibidas. */
  maxSugestoes?: number
  /** Chamado quando o input perde o foco (ex.: `react-hook-form`). */
  onBlur?: () => void
  /** Ref do input (ex.: foco no campo com erro pelo `react-hook-form`). */
  inputRef?: Ref<HTMLInputElement>
  /** Indica que as sugestões ainda estão sendo carregadas. */
  carregando?: boolean
  /** Mensagem quando nada combina com o texto (`null` = não exibe). */
  mensagemVazia?: string | null
}

interface Item {
  chave: string
  label: string
  valor: string
}

/**
 * Campo de busca com sugestões (combobox acessível): filtra `options` conforme
 * o texto digitado e permite seleção por clique ou teclado (↑/↓, Enter e Esc).
 */
export function Autocomplete({
  value,
  onChange,
  options,
  id,
  placeholder,
  className,
  clearLabel,
  ariaLabel,
  maxSugestoes = 50,
  onBlur,
  inputRef,
  carregando = false,
  mensagemVazia = 'Nenhuma sugestão encontrada.',
}: AutocompleteProps) {
  const generatedId = useId()
  const inputId = id ?? `autocomplete-${generatedId}`
  const listboxId = `${inputId}-listbox`
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)

  const itens = useMemo<Item[]>(() => {
    const termo = value.trim().toUpperCase()
    const filtradas = termo ? options.filter((o) => o.toUpperCase().includes(termo)) : options
    // Prioriza as opções que começam com o texto digitado (ordem original preservada).
    const ordenadas = termo
      ? [
          ...filtradas.filter((o) => o.toUpperCase().startsWith(termo)),
          ...filtradas.filter((o) => !o.toUpperCase().startsWith(termo)),
        ]
      : filtradas
    const sugestoes = ordenadas
      .slice(0, maxSugestoes)
      .map<Item>((option) => ({ chave: option, label: option, valor: option }))

    if (clearLabel && value.trim().length > 0) {
      return [{ chave: '__clear', label: clearLabel, valor: '' }, ...sugestoes]
    }
    return sugestoes
  }, [options, value, clearLabel, maxSugestoes])

  // Fecha a lista ao clicar fora do componente.
  useEffect(() => {
    if (!open) return
    function handleMouseDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  function selecionar(item: Item) {
    onChange(item.valor)
    setOpen(false)
    setHighlight(-1)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((atual) => Math.min(atual + 1, itens.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((atual) => Math.max(atual - 1, 0))
    } else if (event.key === 'Enter') {
      if (open && highlight >= 0 && itens[highlight]) {
        event.preventDefault()
        selecionar(itens[highlight])
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${inputId}-option-${highlight}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        className={inputClassName}
      />

      {open && itens.length > 0 ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {itens.map((item, indice) => (
            <li
              key={item.chave}
              id={`${inputId}-option-${indice}`}
              role="option"
              aria-selected={indice === highlight}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selecionar(item)}
              onMouseEnter={() => setHighlight(indice)}
              className={cn(
                'cursor-pointer px-3 py-1.5 text-sm',
                indice === highlight
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {open && itens.length === 0 && (carregando || mensagemVazia) ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg">
          {carregando ? 'Carregando sugestões…' : mensagemVazia}
        </div>
      ) : null}
    </div>
  )
}
