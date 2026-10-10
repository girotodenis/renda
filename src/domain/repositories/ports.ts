import type { SheetName } from '@/domain/sheetsSchema'

/**
 * Contratos (ports) de persistência — camada de domínio.
 *
 * A camada de domínio define **o que** os repositórios fazem; a infraestrutura
 * (`src/infrastructure/repositories.ts`) implementa **como** fazem. Essa é a
 * inversão de dependência (DIP): o domínio não conhece o Google Sheets, apenas
 * o contrato genérico abaixo.
 */

/** Contexto de acesso: token OAuth + planilha ativa. */
export interface RepositoryContext {
  accessToken: string
  spreadsheetId: string
}

export interface ListOptions {
  /** Ignora o cache e busca direto da API (refresh explícito do usuário). */
  forceRefresh?: boolean
}

/** Contrato de um repositório de aba. */
export interface Repository<T> {
  readonly sheetName: SheetName
  /** Gera um novo ID (UUID/timestamp) — nunca reutilizado. */
  newId(): string
  /** Lê do cache quando disponível; senão busca da API e popula o cache. */
  list(context: RepositoryContext, options?: ListOptions): Promise<T[]>
  /** Lê apenas o cache da aba (sem rede) — `null` quando ausente. */
  readCache(spreadsheetId: string): T[] | null
  /** Busca dados atuais da API e atualiza o cache. */
  refresh(context: RepositoryContext): Promise<T[]>
  /** Acrescenta uma entidade e invalida o cache da aba. */
  append(context: RepositoryContext, entity: T): Promise<T>
  /** Substitui as linhas de dados da aba (preserva colunas de fórmulas). */
  replaceAll(context: RepositoryContext, entities: readonly T[]): Promise<void>
  /** Invalida o cache da aba. */
  invalidateCache(spreadsheetId: string): void
}

/** Repositório com CRUD completo para abas cujas entidades têm ID único. */
export interface CrudRepository<T> extends Repository<T> {
  /** Substitui a entidade de mesmo ID (re-escrita segura da aba). */
  update(context: RepositoryContext, entity: T): Promise<T>
  /** Remove a entidade pelo ID (re-escrita segura da aba). */
  remove(context: RepositoryContext, id: string): Promise<void>
}
