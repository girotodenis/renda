# Plano de implementação — Página **Consolidação** (histórico por ticker/ano)

> Status: **implementado** (fases 1–4: domínio, caso de uso, UI e avisos/docs).
> Objetivo: reduzir o volume de linhas das abas `Operacoes` e `Proventos` sem
> alterar nenhum número exibido no app, oferecendo:
> 1. uma página que lista os **tickers encerrados (100% vendidos) ainda não
>    consolidados** e consolida tudo em **1 compra + 1 venda** + proventos
>    agregados por ano/tipo;
> 2. consolidação **por ano** para tickers com posição aberta (anos anteriores
>    ao corrente), sempre preservando posição, preço médio, lucro realizado e
>    totais de proventos.

---

## 0. Decisões fechadas (não rediscutir sem motivo)

| # | Decisão | Escolha |
| --- | --- | --- |
| 1 | Granularidade dos proventos | **1 linha por tipo por ano** (`Dividendo`/`JCP`/`Rendimento`) — preserva tratamento tributário e os gráficos por tipo |
| 2 | Operações de ticker ativo por ano | Só consolida operações quando o ano é **auto-contido** (posição 0 no início **e** no fim do ano). Caso contrário consolida **apenas os proventos** do ano |
| 3 | Corte de anos | Somente anos **anteriores ao ano corrente** |
| 4 | Reimportação B3 depois de consolidar | **Sem** estado extra (nada de lista de IDs em `Configuracoes`) e **sem** bloqueio: apenas aviso na tela de consolidação e na importação (§6.3) |
| 5 | Marcar linhas consolidadas na aba `Operações` | **Não** sinalizar (sem prefixo de ID, sem badge) |
| 6 | "Só proventos" para ticker **encerrado** | **Não**: o botão do ticker encerrado consolida tudo o que houver (operações + proventos) |

### Sem automação e sem desfazer

- **Nada é consolidado automaticamente.** Nenhuma rotina de carga, sincronização
  ou importação consolida nada. A consolidação só acontece por ação explícita do
  usuário, item a item, na página **Consolidação**.
- **Não há histórico/ledger e não há "Desfazer".** Consolidação é uma operação
  **destrutiva e irreversível**: as linhas originais são apagadas e substituídas
  pelas linhas agregadas. Não são criadas abas, colunas nem marcadores novos.
- A tela **informa antes de gravar** exatamente o que acontece com os dados (§5.2)
  e oferece o **backup `.ods`** como rede de segurança (§8).

Consequências aceitas explicitamente:

- O detalhe do ativo (`DetalheAtivoModal`) passa a mostrar **1 preço médio de
  compra** e **1 venda** no lugar das operações originais, e as datas
  "1ª compra / última compra" viram as da consolidação.
- O extrato de proventos e o gráfico "por mês" perdem a distribuição mensal
  daqueles anos (passam a mostrar o total do ano na data do **último**
  pagamento do grupo).
- Não é um recurso para apuração mensal de imposto.
- Reimportar um extrato B3 de um período já consolidado volta a criar os
  lançamentos originais (duplicidade) — ver §6.3.

---

## 1. Como o app calcula hoje (o que a consolidação precisa preservar)

| Regra | Onde | Precisa sobreviver à consolidação? |
| --- | --- | --- |
| Quantidade, preço médio e total investido por ticker (custo médio incremental, eventos corporativos por fator) | [`calcularPosicoes`](src/domain/consolidado.ts) | **Sim, exato** |
| Lucro realizado venda a venda contra o custo médio do momento | [`calcularFluxoRealizado`](src/domain/detalheAtivo.ts) | **Sim, exato** |
| Fatores de split/grupamento/bonificação (`fatorQuantidade`) | [`eventosCorporativos.ts`](src/domain/eventosCorporativos.ts) | **Sim** (eventos absorvidos viram fator de escala) |
| `Valor Bruto Atual` (marcação manual de RF/Tesouro e preço persistido de B3) lido da operação de **data mais recente** | [`precosBrutosMaisRecentes`](src/domain/cotacoes.ts) | **Sim** (copiada para a linha consolidada de maior data) |
| `Indexador` / `% do Indexador` / `Vencimento` da RF | [`operacoesCodec`](src/infrastructure/sheets/sheetCodecs.ts) | **Sim** (copiados da operação mais recente) |
| Totais de proventos por ano/tipo | [`agruparProventosPorAno`](src/domain/dashboard.ts) / [`agruparProventosPorTipo`](src/domain/dashboard.ts) | **Sim, exato** |

Dinheiro em **centavos inteiros**, datas ISO `YYYY-MM-DD`, arredondamento com
`round2`. `precoUnitario` é sempre inteiro em centavos (a célula é gravada como
reais com 2 casas — não é possível usar fração de centavo).

---

## 2. Modelo de dados: **nenhuma aba nova**

Como não há histórico nem estado de "consolidado", a página é calculada
inteiramente a partir das abas `Operacoes` e `Proventos`. Isso mantém o escopo
pequeno: **`domain/sheetsSchema.ts`, codecs, repositórios, `.ods`, migração,
outbox e diagnóstico não mudam.**

### 2.1 O que significa "já consolidado"

Não há flag. O critério é objetivo e derivado dos próprios dados: **só existe
algo a consolidar quando há grupo com 2 ou mais linhas** (ou evento corporativo).

```ts
export function precisaConsolidar(
  operacoesDoTicker: readonly Operacao[],
  proventosDoTicker: readonly Provento[],
): { operacoes: boolean; proventos: boolean }
```

- **Operações:** `compras + vendas > 2` **ou** existe ao menos um evento
  corporativo (`Split`/`Grupamento`/`Bonificacao`).
- **Proventos:** existe algum par `(ano, tipo)` com **≥ 2** linhas.

Consequências:

- Depois de consolidar, o ticker/ano deixa de satisfazer o critério e **desaparece
  da lista** — comportamento idempotente sem armazenar nada.
- Um ticker encerrado com exatamente **1 compra + 1 venda** e 1 provento por
  tipo/ano nunca aparece (não há ganho em consolidar).
- Se o usuário lançar operações novas num ticker já consolidado, ele volta a
  aparecer como pendente e pode ser consolidado de novo (os números continuam
  exatos — §3.5).

---

## 3. Domínio — `src/domain/consolidacao.ts` (puro, sem rede/UI)

> Nome propositalmente distinto de `domain/consolidado.ts` (posições da
> carteira). Alternativa, se preferirem explicitude: `consolidacaoHistorica.ts`.

### 3.1 Detecção de pendências (alimenta a página)

```ts
export interface PendenciaConsolidacao {
  ticker: string
  categoria: CategoriaAtivo
  estado: 'encerrado' | 'ativo'
  /** Operações que seriam absorvidas (0 quando só há proventos a agregar). */
  operacoesParaAbsorver: number
  /** Proventos que seriam absorvidos. */
  proventosParaAbsorver: number
  primeiraCompra: string | null
  ultimaVenda: string | null
  totalCompras: number
  totalVendas: number
  totalProventos: number
  lucroRealizado: number
  /** Anos elegíveis (< ano corrente) com pendência, para tickers ativos. */
  anos: AnoPendente[]
  /** Motivo de bloqueio (histórico inconsistente) — `null` quando pode consolidar. */
  impedimento: string | null
}

export interface AnoPendente {
  ano: number
  modo: 'Completo' | 'SomenteProventos'   // §3.3
  operacoesParaAbsorver: number
  proventosParaAbsorver: number
  impedimento: string | null
}

export function analisarPendencias(
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  anoCorrente: number,
): PendenciaConsolidacao[]
```

Regras:

1. `estado = 'encerrado'` quando `calcularPosicoes` do ticker devolve
   `quantidadeAtual === 0` **e** existe ao menos uma `Compra` e uma `Venda`.
2. Ticker encerrado com `precisaConsolidar` (§2.1) → escopo **ticker inteiro**.
3. Ticker ativo: anos com pendência **< `anoCorrente`** → escopo **por ano**.
   - `modo = 'Completo'` quando a quantidade no **fim do ano anterior** e no
     **fim do ano** são ambas `0` (ano auto-contido).
   - `modo = 'SomenteProventos'` caso contrário.
4. `impedimento` preenchido (botão desabilitado, com explicação) quando a
   pré-validação de §3.2.2 falha.
5. Ordenação determinística: encerrados primeiro (por ticker), depois ativos.

### 3.2 Consolidação de um ticker encerrado (exata)

Entrada: operações do ticker (compras, vendas **e eventos**), proventos.

1. Ordenar por `data`, desempate `id`.
2. **Pré-validação** (rejeita histórico inconsistente): percorrer as operações
   cronologicamente e abortar se, em qualquer passo, a quantidade ficar
   **negativa** (venda a descoberto) ou o custo ficar negativo. O app não modela
   posição vendida e, nesses casos, `calcularPosicoes`/`calcularFluxoRealizado`
   já produzem números sem sentido — consolidar perpetuaria o erro.
3. Calcular o **fator residual** de cada linha: produto dos fatores de
   quantidade (`fatorQuantidade`) dos eventos **posteriores** a ela e anteriores
   à última compra/venda. Percorrer de trás para frente acumulando o sufixo.
   Eventos **posteriores à última compra/venda** atuam sobre posição zero: são
   absorvidos sem influir na escala (evita inflar quantidade).
4. `Q = Σ (quantidade × fatorResidual)` das compras e
   `Qv = Σ (quantidade × fatorResidual)` das vendas. Se `Q !== Qv` ou `Q === 0`,
   **abortar** (posição não fecha em zero — ex.: eventos corporativos
   inconsistentes). Não arredondar por operação: somar em precisão cheia e
   arredondar apenas o total com `round2`.
5. `C = Σ (quantidade × precoUnitario + taxas)` das compras;
   `P = Σ (quantidade × precoUnitario)` das vendas.
   *(Taxas de venda não entram: o app não as desconta do lucro realizado hoje —
   ver [`calcularFluxoRealizado`](src/domain/detalheAtivo.ts).)*
6. Resíduo de arredondamento `r = P mod Q` (`0 ≤ r < Q`). Grava-se:
   - **Compra consolidada**: `quantidade = Q`,
     `precoUnitario = floor((C − r) / Q)`,
     `taxas = (C − r) − precoUnitario × Q` (sempre `≥ 0` e `< Q`);
   - **Venda consolidada**: `quantidade = Q`, `precoUnitario = floor(P / Q)`.
   - Verificação: custo total `= C − r`, receita total `= P − r`, logo
     **lucro realizado `= P − C`, exato**. O preço médio fica a menos de
     **1 centavo por ação** do valor real (irrelevante: posição encerrada tem
     `preço médio = 0` no `Consolidado`).
7. Datas: compra = **menor** data de compra do ticker; venda = **maior** data de
   venda (garante ordem compra → venda no custo médio incremental).
8. Metadados copiados da operação original **mais recente** (por data/ID):
   `categoria`, `indexador`, `percentualIndexador`, `vencimento`,
   `valorBrutoAtual` — gravados na linha consolidada de **maior data** (é de lá
   que `precosBrutosMaisRecentes` lê).
9. `id` novos via `newId()`; `tipo = Compra` / `Venda`.
10. Sem ganho (`≤ 2` operações e nenhum evento): **não** mexer nas operações —
    consolidar só os proventos.

### 3.3 Consolidação por ano

- **`Completo`** (ano auto-contido, `q0 = 0` e `q1 = 0`): mesmo algoritmo de
  §3.2 restrito às operações do ano. O estado da carteira antes/depois do ano é
  `0`, então o resultado é **exato** e anos posteriores não são afetados.
  Datas: 1ª compra do ano → última venda do ano.
- **`SomenteProventos`**: operações do ano **não são tocadas**; consolida só os
  proventos (§3.4).

Quando o ano é `Completo` **e** tem proventos, ambos são consolidados na mesma
ação.

### 3.4 Proventos por ano/tipo

Agrupar por `(ano(dataPagamento), tipo)`; para cada grupo com **≥ 2** linhas:

- `valorTotal = Σ valorTotal`;
- `dataPagamento = maior data do grupo`; `dataCom = null`;
- `categoria`/`ticker` do grupo; `id` novo; `tipo` preservado.

Grupos com 1 linha ficam como estão (evita churn). Linhas com `dataPagamento`
inválida ficam fora da consolidação e são reportadas na tela.

> **Aritmética já validada na fase de planejamento:** o algoritmo de §3.2 foi
> simulado fora do app contra as mesmas regras de `calcularPosicoes` e
> `calcularFluxoRealizado` em ~5.700 sequências aleatórias válidas (com split,
> grupamento, bonificação, eventos após zerar a posição e resíduo de
> arredondamento): **100% exatas** (Δlucro realizado = 0, posição final = 0).
> Os casos que falharam na simulação eram todos históricos inválidos (venda a
> descoberto), cobertos pela pré-validação de §3.2.2.

### 3.5 Verificação de invariantes (obrigatória antes de gravar)

```ts
export interface Divergencia { metrica: string; esperado: number; obtido: number }

export function verificarInvariantes(
  antes: { operacoes: readonly Operacao[]; proventos: readonly Provento[] },
  depois: { operacoes: readonly Operacao[]; proventos: readonly Provento[] },
): Divergencia[]
```

Compara:

| Métrica | Tolerância |
| --- | --- |
| Quantidade por ticker (`calcularPosicoes`) | `0` |
| Total investido por ticker | `0` |
| Preço médio por ticker | `0` (posições abertas não são tocadas) |
| Lucro realizado por ticker (`calcularFluxoRealizado`) | `0` |
| Σ proventos por `(ano, tipo)` | `0` |
| Total de compras / vendas por ticker | `≤ 1` por linha consolidada (resíduo §3.2.6) |

Como não há desfazer, esta verificação é a **única** barreira: qualquer
divergência **aborta a gravação** e é exibida na tela com métrica/esperado/obtido.

### 3.6 Assinatura do cálculo

```ts
export type AlvoConsolidacao =
  | { tipo: 'ticker'; ticker: string }
  | { tipo: 'ticker-ano'; ticker: string; ano: number; modo: ModoConsolidacao }

export interface ResultadoConsolidacaoCalculada {
  operacoes: Operacao[]   // lista final da aba (pendentes + consolidadas)
  proventos: Provento[]   // lista final da aba
  absorvidas: { operacoes: Operacao[]; proventos: Provento[] }
  geradas: { operacoes: Operacao[]; proventos: Provento[] }
  resumo: { totalCompras: number; totalVendas: number; totalProventos: number; lucroRealizado: number }
}

export function calcularConsolidacao(
  alvo: AlvoConsolidacao,
  operacoes: readonly Operacao[],
  proventos: readonly Provento[],
  opcoes: { novoId: () => string },
): ResultadoConsolidacaoCalculada | { erro: string }
```

---

## 4. Caso de uso — `src/application/consolidacao.ts`

```ts
export interface PainelConsolidacao {
  pendencias: PendenciaConsolidacao[]
}

export async function carregarPainelConsolidacao(
  context: RepositoryContext,
): Promise<PainelConsolidacao>

export async function executarConsolidacao(
  context: RepositoryContext,
  alvo: AlvoConsolidacao,
): Promise<{ absorvidas: number; geradas: number }>
```

Fluxo de `executarConsolidacao`:

1. **Guardas**: exigir online (evita consolidar sobre cache defasado) e
   `ano < anoCorrente` no escopo `TickerAno`.
2. `operacoesRepo.refresh` + `proventosRepo.refresh` (relê da API: garante que as
   linhas que serão apagadas são as que estão na planilha agora).
3. `calcularConsolidacao` → resultado; `erro` → lançar com mensagem de domínio.
4. `verificarInvariantes(antes, depois)`; divergência → lançar com detalhe.
5. Gravar as **duas** abas dentro de
   [`executarEmLote`](src/infrastructure/sheets/gatewayRouter.ts) (1 leitura + 1
   escrita no backend JSON do Drive): `operacoesRepo.replaceAll` e, se houve
   mudança de proventos, `proventosRepo.replaceAll`.
6. Pós-gravação: `sincronizarConsolidadoESnapshot(context)`
   ([`escritasAtivo.ts`](src/application/escritasAtivo.ts)) — recalcula
   `Consolidado` e registra snapshot (best-effort).

Não há leitura extra de abas nem novas dependências de repositório.

---

## 5. Página **Consolidação** (UI)

Arquivos novos:

- `src/presentation/features/consolidacao/ConsolidacaoPage.tsx`
- `src/presentation/features/consolidacao/ConfirmarConsolidacaoModal.tsx`
- `src/presentation/features/consolidacao/TabelaEncerrados.tsx`
- `src/presentation/features/consolidacao/TabelaPorAno.tsx`
- `src/presentation/hooks/useConsolidacao.ts` (carregar/executar + estados)

Rota `/consolidacao` em [`App.tsx`](src/presentation/app/App.tsx) (protegida por
`ProtectedRoute`) e item de menu em
[`AppLayout.tsx`](src/presentation/app/layout/AppLayout.tsx) (ícone `Archive`,
rótulo **Consolidação**).

### 5.1 Blocos da tela

1. **Aviso fixo** (card, sempre visível):
   - a consolidação **só acontece quando você clicar** — nada é automático;
   - substitui N operações por **1 compra + 1 venda** e N proventos por **1 por
     tipo/ano**;
   - **não** altera posição, preço médio, total investido, lucro realizado nem
     totais de proventos (verificado antes de gravar);
   - **é irreversível**: as linhas originais são apagadas; não há "Desfazer".
     Exporte um backup `.ods` antes (link para Configurações → backup).
2. **Ativos encerrados (100% vendidos)** — tabela: Ticker, Categoria, Período,
   Nº operações, Nº proventos, Total compras, Total vendas, Lucro realizado,
   Total proventos e botão **Consolidar**. Itens com `impedimento` aparecem com
   o motivo e o botão desabilitado.
3. **Ativos com posição aberta — por ano**: linha expansível por ticker com um
   sub-linha por ano elegível (`< ano corrente`), exibindo o modo sugerido
   (`Completo` ou `Somente proventos`) e o botão **Consolidar o ano**.
4. Estados: `isLoading`, `Alert` de erro (`describeSheetsError`), estado vazio
   ("Nada a consolidar"), aviso de offline (botões desabilitados), `Pagination`
   quando necessário.

### 5.2 Modal de confirmação (o usuário é informado antes)

Mostra, com números reais do item escolhido:

- escopo (ticker inteiro ou ticker + ano) e o modo;
- **quantas linhas serão apagadas** e **quantas serão criadas** (ex.: "42
  operações e 17 proventos serão substituídas por 1 compra, 1 venda e 6
  proventos — 1 por tipo/ano");
- totais de compra, venda e proventos resultantes;
- lista explícita dos efeitos colaterais de §0 ("o detalhe do ativo passará a
  mostrar 1 compra e 1 venda", "o extrato de proventos passa a mostrar o total do
  ano na data do último pagamento", "**esta ação não pode ser desfeita**");
- link **Exportar backup (.ods)** (usa `exportarPlanilhaOds`, já existente em
  `ConfiguracoesPage`/`SegurancaBancoCard`);
- checkbox obrigatório "Entendi que a consolidação é irreversível" — o botão
  **Consolidar** só habilita com ele marcado.

Depois de gravar: `Alert` de sucesso com o resumo e recarga da lista.

---

## 6. Integrações

### 6.1 Modo local, criptografia, offline

- **Modo local**: sem mudanças (IndexedDB); o `.ods` exportado já reflete o
  resultado.
- **Criptografia**: sem mudanças (nenhuma aba nova).
- **Offline**: `Consolidar` exige online (guarda em §4.1); a leitura da página
  funciona offline (cache das abas).

### 6.2 Importação `.ods` / migração / diagnóstico

**Nenhuma mudança** — `SHEET_NAMES` continua com 8 abas.

### 6.3 Importação B3 (risco aceito — apenas aviso, decisão 4)

Sem histórico, não há como deduplicar o que foi consolidado: reimportar o extrato
de um período já consolidado **recria os lançamentos originais** (duplicidade),
porque a dedupe atual é por ID determinístico do arquivo
([`importarExtratoB3`](src/application/b3Import.ts)).

- Aviso permanente na `ImportarB3Page` e no modal de consolidação: "Consolidar
  apaga os lançamentos originais; reimportar o mesmo extrato depois vai duplicar
  esse período".
- Recomendação na tela: consolidar somente períodos que **não** serão reimportados
  (por isso o padrão é trabalhar com anos anteriores ao corrente).

---

## 7. Casos de borda e mensagens

| Caso | Comportamento |
| --- | --- |
| Posição fica negativa em algum ponto (venda a descoberto) | `impedimento`: "Histórico de X tem venda sem posição; ajuste as operações antes de consolidar." Botão desabilitado. |
| `Q !== Qv` (posição não fecha em zero) | `impedimento`: "As operações de X não fecham em quantidade zero (eventos corporativos?). Ajuste os eventos antes de consolidar." |
| `Q === 0` (quantidades zeradas por eventos) | Mesmo bloqueio. |
| Ticker com só compras (posição aberta) | Só aparece na seção "por ano", em anos elegíveis. |
| Ano corrente | Nunca sugerido (§0, decisão 3). |
| Ano com posição em aberto | Modo `SomenteProventos`; operações permanecem detalhadas. |
| Ano auto-contido com 1 compra + 1 venda | Não aparece (nada a consolidar). |
| Usuário lança operação nova num ticker/ano já consolidado | Volta a aparecer como pendente; consolidar de novo é permitido e continua exato. |
| Divergência de invariantes | Gravação abortada; tela mostra métrica/esperado/obtido. |
| Renda Fixa / Tesouro Direto | Permitido; `valorBrutoAtual`, `indexador`, `% do Indexador` e `vencimento` preservados na linha de maior data (§3.2.8), com aviso extra no modal (a marcação manual é o preço de mercado). |
| Provento com `dataPagamento` inválida | Fora da consolidação; contagem reportada na tela. |

---

## 8. Salvaguardas (substituem o "Desfazer")

1. Confirmação com números + checkbox de irreversibilidade (§5.2).
2. Link direto para **exportar backup `.ods`** antes de consolidar.
3. `verificarInvariantes` bloqueante (§3.5).
4. Consolidação sempre relê as abas da API antes de gravar (§4.2) — nunca opera
   sobre cache defasado.
5. Escopo restrito: apenas o ticker/ano escolhido é tocado; as demais linhas são
   reescritas idênticas.

---

## 9. Testes

### 9.1 Domínio (`src/domain/consolidacao.test.ts`)

- Ticker encerrado com 5 compras + 4 vendas → 1 compra + 1 venda; posição `0`;
  `lucroRealizado` idêntico; `Σ compras` e `Σ vendas` preservados.
- Ticker encerrado **com split 1:2** e **grupamento 10:1** no meio → `Q`
  ajustado, `lucroRealizado` idêntico (base do bug mais provável).
- Evento corporativo **depois** da última venda → absorvido sem inflar `Q`.
- Resíduo de arredondamento (`P mod Q ≠ 0`) → lucro realizado exato e
  `taxas ≥ 0`.
- Venda a descoberto / `Q ≠ Qv` / `Q = 0` → `impedimento`, sem alteração.
- Ano auto-contido (`q0 = q1 = 0`) → 2 linhas; anos seguintes intactos.
- Ano com posição em aberto → **só** proventos consolidados, operações intactas.
- Proventos por ano/tipo → 1 linha por grupo, `dataPagamento` = último
  pagamento, soma preservada; grupo de 1 linha intocado.
- `analisarPendencias`: encerrado vs ativo; anos `< anoCorrente`; ticker com
  ≤ 2 operações e 1 provento por tipo/ano **não** aparece; após consolidar
  (simulado) deixa de aparecer.
- `verificarInvariantes` detecta divergência injetada (ex.: perder um provento).

### 9.2 Aplicação (`src/application/consolidacao.test.ts`)

Com repositórios falsos em memória: grava as duas abas com `replaceAll`, aborta
por divergência de invariantes, guarda de offline, escopo restrito (tickers
alheios inalterados).

### 9.3 Manual (checklist)

1. Exportar `.ods`; consolidar um ticker encerrado de teste; conferir Dashboard
   (patrimônio, lucro), detalhe do ativo, extrato de proventos e `Operações`.
2. Consolidar um ano auto-contido e um ano com posição em aberto.
3. Conferir que o item consolidado sai da lista e não volta ao recarregar.
4. Tentar consolidar offline → botões desabilitados com mensagem.
5. Reimportar o extrato B3 do período consolidado → conferir o aviso e a
   duplicidade esperada (comportamento documentado).

---

## 10. Fases de execução

| Fase | Entrega | Arquivos |
| --- | --- | --- |
| **1** | Domínio puro + testes | `src/domain/consolidacao.ts`, `src/domain/consolidacao.test.ts` |
| **2** | Caso de uso (invariantes + gravação em lote) | `src/application/consolidacao.ts` (+ teste) |
| **3** | UI + rota + menu | `presentation/features/consolidacao/*`, `presentation/hooks/useConsolidacao.ts`, `presentation/app/App.tsx`, `presentation/app/layout/AppLayout.tsx` |
| **4** | Avisos na importação B3 e docs | `presentation/features/importar/ImportarB3Page.tsx`, `ARCHITECTURE.md`, `README.md` |

Sem fase de esquema/repositórios: o escopo de dados não muda.

```bash
npm run test -- src/domain/consolidacao.test.ts   # fase 1
npm run lint && npm run typecheck && npm run test # antes de cada entrega
```

---

## 11. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Aritmética errada corromper posição/lucro (**sem desfazer**) | `verificarInvariantes` bloqueante antes de gravar + pré-validação de histórico inválido + ~15 testes de borda; aritmética já validada por simulação (~5.700 casos) |
| Usuário se arrepender | Backup `.ods` no próprio modal + confirmação com números + checkbox |
| Reimportação B3 duplicar dados | **Risco aceito** (§0, decisão 4): aviso obrigatório na tela de consolidação e na `ImportarB3Page`; consolidar só períodos antigos |
| Perda da granularidade mensal (IR) | Opt-in por ano, só anos anteriores, aviso no modal, backup |
| Gravação pela metade (Sheets/local) | `executarEmLote` no backend JSON; nos demais, relê antes e grava Operações → Proventos em sequência, com invariantes calculadas antes |
| Lista "infinita" de pendências | Critério §2.1 exige ≥ 2 linhas por grupo; tickers já enxutos nunca aparecem |

---

## 12. Critérios de aceite

1. Página **Consolidação** lista encerrados pendentes e anos elegíveis de ativos,
   com o aviso de efeitos/irreversibilidade visível.
2. Nada é consolidado sem clique explícito + checkbox no modal.
3. Consolidar um ticker encerrado gera **exatamente** 1 compra + 1 venda (+ 1
   provento por tipo/ano) e **nenhum** número do dashboard muda (patrimônio,
   total investido, lucro, proventos por ano/tipo).
4. `calcularFluxoRealizado` do ticker permanece idêntico (lucro realizado).
5. Anos auto-contidos consolidam 2 linhas; anos com posição aberta consolidam
   apenas proventos.
6. Tickers inconsistentes (venda a descoberto, `Q ≠ Qv`) aparecem com motivo e
   não podem ser consolidados.
7. Item consolidado sai da lista e não reaparece ao recarregar a página.
8. Nenhuma aba/coluna nova; `SHEET_NAMES` continua com 8 abas.
9. `npm run typecheck`, `npm run lint`, `npm run test` e `npm run build` verdes.

---

## 13. Fora de escopo (decidido — não implementar)

Registrado para não voltar à mesa:

| Item | Por que ficou fora |
| --- | --- |
| Lista de IDs absorvidos em `Configuracoes` para deduplicar reimportação B3 | Cria estado persistido e um segundo mecanismo de verdade sobre "o que já foi consolidado". O risco de duplicidade fica coberto por aviso explícito (§6.3) e por consolidar apenas anos anteriores. |
| Badge/prefixo de ID marcando linhas consolidadas em `Operações` | Sem ledger, qualquer marcação vira estado paralelo; a linha consolidada é apenas uma operação (1 compra + 1 venda) e o usuário a reconhece pelo formato. |
| Modo "só proventos" para ticker encerrado | O caso principal é justamente enxugar as operações do ticker encerrado. Quem quiser manter as operações detalhadas pode simplesmente não consolidar aquele ticker (ou usar o modo por ano, que só toca proventos quando o ano tem posição em aberto). |

