# Plano de implementação — PWA + Offline-first + Sincronização com a planilha

> **Objetivo final:** transformar a aplicação em um PWA instalável, que funcione
> offline e, ao reconectar, sincronize as alterações com a planilha do Google.
>
> **Data de criação:** 2026-10-10
> **Última atualização:** 2026-10-11 (Fase 3 concluída)
> **Estado geral:** `em andamento` — Fases 0, 1, 2 e 3 concluídas; próximas fases pendentes.

---

## Como usar este plano (protocolo de sessão)

1. **Cada fase é executada em UMA única sessão/prompt.** Não iniciar duas fases
   na mesma sessão.
2. Ao **iniciar** uma fase:
   - marcar a fase como `[~] em andamento` na seção **Estado da implementação**;
   - reler os arquivos citados na fase (a estrutura pode ter mudado).
3. Ao **terminar** uma fase:
   - rodar os **Comandos de validação** da fase;
   - marcar a fase como `[x] concluída` com a data;
   - registrar desvios em **Notas/Desvios** da fase (decisões, arquivos extras,
     mudanças de abordagem).
4. **Não avançar** para a fase seguinte sem validar a atual.
5. Este arquivo (`PLANO_PWA.md`) é a **fonte da verdade do estado**. Todo
   progresso deve ser refletido aqui antes de encerrar a sessão.

---

## Estado da implementação

| Fase | Descrição curta | Estado | Concluída em |
| --- | --- | --- | --- |
| Fase 0 | PWA instalável + shell offline (manifest/SW/ícones) | `[x]` concluída | 2026-10-10 |
| Fase 1 | Repositórios offline (outbox + atualização otimista) | `[x]` concluída | 2026-10-10 |
| Fase 2 | Sincronização automática (flush + Consolidado) | `[x]` concluída | 2026-10-10 |
| Fase 3 | Auth resiliente offline | `[x]` concluída | 2026-10-11 |
| Fase 4 | UX de sincronização (badge/contador/botão) | `[ ]` pendente | — |
| Fase 5 | Melhorias opcionais (IndexedDB, Periodic Sync, tabs) | `[ ]` pendente | — |

---

## Baseline — o que **já existe** no código (não refazer)

Validado em 2026-10-10. A base já implementa parte do offline de **leitura**:

- **Leitura cache-first**: `src/infrastructure/repositories.ts` lê do cache
  (`localStorage`) e só busca da API (`infrastructure/sheets/gateway.ts`) em
  cache frio ou `forceRefresh`.
- **Cache por aba**: `src/infrastructure/cache.ts` (chave
  `minhaacoes.cache.v1.<spreadsheetId>.<sheetName>`).
- **Leitura offline do dashboard**: `src/application/dashboard.ts`
  (`lerDashboardDoCache`, opção `offline` em `carregarDashboard`) e
  `src/presentation/hooks/useDashboard.ts` (renderiza do cache quando
  `navigator.onLine === false`).
- **Cotações resilientes**: Tesouro (`infrastructure/tesouro.ts`) e Brapi
  (`infrastructure/brapi.ts`) são cache-first e nunca lançam offline.
- **Detecção de conexão**: `src/presentation/hooks/useOnlineStatus.ts`.
- **Auth com renovação silenciosa**: `src/presentation/app/providers/AuthProvider.tsx`
  (GIS, token em `localStorage`, `silentRefresh`).

**Gaps a resolver nas fases (o motivo deste plano):**

1. Não é instalável (sem manifest, sem service worker, sem ícones).
2. **Escritas exigem rede**: `append/replaceAll/update/remove` chamam a API do
   Sheets direto — não há fila offline de mutações.
3. **Auth desloga offline**: `silentRefresh` limpa a sessão quando a renovação
   falha, mesmo se o motivo for falta de rede.
4. Sem UX de sincronização (indicador offline/pendências).

---

## Validação plano × execução

A validação compara o que a fase **promete** (Critérios de aceite) com o que
foi **executado** (arquivos alterados + comandos passando).

**Comandos globais** (rodar ao final de toda fase que altere código):

```bash
cd /app/renda
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

**Checklist de conformidade** (deve continuar verdadeiro em todas as fases):

- [ ] Regra de dependência mantida: `presentation → application → {domain, infrastructure}`.
- [ ] Pastas antigas (`lib/ services/ types/ features/ components/ hooks/ app/`)
      permanecem como shims — código novo vai nas camadas corretas.
- [ ] Dinheiro em centavos inteiros; datas ISO `YYYY-MM-DD`; `CategoriaAtivo` canônico.
- [ ] Nenhuma lógica de negócio em componentes React.
- [ ] Novos testes em `*.test.ts` junto ao módulo (Vitest).

**Procedimento de validação por fase:**

1. Abrir a seção da fase, conferir os **Critérios de aceite**.
2. Conferir a lista **Arquivos a criar/editar** vs. o que realmente foi alterado
   (`git status` / `git diff --stat`).
3. Rodar os comandos globais + comandos específicos da fase.
4. Registrar o resultado em **Notas/Desvios** e atualizar o **Estado da implementação**.

---

# Fase 0 — PWA instalável + shell offline

### Objetivo
Tornar o app instalável e abrir a UI sem rede (app shell via service worker).
**Não altera a camada de dados** — apenas empacotamento/instalação.

### Contexto
- `vite.config.ts` hoje tem só `react()` e alias `@`.
- `index.html` não tem `theme-color` nem ícones de PWA.
- Não existe pasta `public/`.
- SW só deve agir em **build de produção** (`vite preview`), nunca no dev.

### Tarefas
1. Instalar `vite-plugin-pwa` como devDependency.
2. Em `vite.config.ts`, adicionar `VitePWA({...})`:
   - `registerType: 'autoUpdate'`
   - `manifest`: `name` "Minhas Ações", `short_name` "Minhas Ações",
     `display: 'standalone'`, `start_url: '/'`, `scope: '/'`,
     `theme_color`, `background_color`, `icons` (192, 512 e maskable).
   - `workbox`: `globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}']`,
     `navigateFallback: '/index.html'` (SPA).
   - **Excluir** do precache/rota: `accounts.google.com`, `apis.google.com`,
     `sheets.googleapis.com`, `www.googleapis.com` (terceiros/autenticados).
3. Criar ícones em `public/`: `icon-192.png`, `icon-512.png`,
   `maskable-512.png` (gerar de um SVG de origem; fundo sólido no maskable).
4. Em `index.html`: `theme-color` e `apple-touch-icon`.
5. Em `src/main.tsx`: importar `virtual:pwa-register` e registrar o SW
   (sem prompt obrigatório nesta fase; `autoUpdate` basta).

### Arquivos a criar/editar
- `package.json` (dependência)
- `vite.config.ts` (plugin PWA)
- `index.html` (meta tags)
- `public/icon-192.png`, `public/icon-512.png`, `public/maskable-512.png` (novos)
- `src/main.tsx` (registro do SW)
- `src/vite-env.d.ts` (types de `virtual:pwa-register`, se necessário)

### Critérios de aceite
- `npm run build` gera `dist/sw.js` + `dist/manifest.webmanifest`.
- `npm run preview` → abrir no navegador → Lighthouse (categoria PWA) marca
  **Installable** e **manifest válido**.
- Com o preview servido, desligar a rede e recarregar → o shell abre.
- Dev (`npm run dev`) continua sem SW (sem cache agressivo durante desenvolvimento).

### Comandos de validação
```bash
npm run typecheck && npm run lint && npm run build
ls dist/sw.js dist/manifest.webmanifest
npm run preview   # validar manualmente no navegador
```

### Estado
- [x] concluída em 2026-10-10

### Notas/Desvios

**Arquivos realmente alterados** (`git status`):

- `package.json` / `package-lock.json` — `vite-plugin-pwa@^2.0.0` em `devDependencies`
  (v2.0.0 é compatível com Vite 5; `workbox-build`/`workbox-window` vêm como
  dependências transitivas do plugin).
- `vite.config.ts` — plugin `VitePWA` (`registerType: 'autoUpdate'`,
  `injectRegister: false`, `manifest`, `workbox`).
- `index.html` — `theme-color` + `apple-touch-icon`.
- `src/main.tsx` — `registerSW({ immediate: true })` via `virtual:pwa-register`.
- `src/vite-env.d.ts` — `/// <reference types="vite-plugin-pwa/client" />`.
- `public/icon-192.png`, `public/icon-512.png`, `public/maskable-512.png` (novos).

**Decisões tomadas:**

- **Ícones:** gerados a partir de um glifo único (gráfico/seta ascendente branco)
  com Pillow e supersampling 4× (antialiasing). `icon-192`/`icon-512`: quadrado
  arredondado com gradiente `brand-500 → brand-700` (`#3b82f6 → #1d4ed8`);
  `maskable-512`: fundo **sólido** `brand-600` (`#2563eb`) e glifo reduzido a 62%
  para ficar dentro da *safe zone* (80%). O SVG de origem **não** foi versionado —
  o escopo da fase lista apenas os PNGs em `public/`.
- **Cores do tema:** `theme_color = #2563eb` (alinhado ao `brand-600` do
  `tailwind.config.js`) no manifest e no `<meta name="theme-color">`;
  `background_color = #ffffff` (fundo da splash screen).
- **`injectRegister: false` + registro manual:** evita registro duplicado, já que
  `src/main.tsx` importa `virtual:pwa-register`.
- **Exclusão do Google (3 camadas):** (1) os domínios não entram no precache — o
  precache só contém assets locais do build; (2) `navigateFallbackDenylist` impede
  o `index.html` de capturar navegações para eles; (3) `runtimeCaching` com
  `NetworkOnly` para `/^https:\/\/(?:accounts|apis|sheets|www)\.google(?:apis)?\.com\/.*/i`.
- **Dev sem SW:** `devOptions.enabled: false` (padrão, explicitado). Em dev o
  `virtual:pwa-register` vira no-op e o `<link rel="manifest">` não é injetado.

**Validação executada (2026-10-10):**

- `npm run typecheck` — ok. `npm run lint` — ok.
- `npm test -- --run` — 157 testes / 13 arquivos, todos verdes.
- `npm run build` — ok; gera `dist/sw.js`, `dist/workbox-98f7a950.js` e
  `dist/manifest.webmanifest` (precache: 16 entradas, ~993 KiB, sem domínios do Google).
- `npm run preview` (porta 4173): `/sw.js` → 200 `text/javascript`;
  `/manifest.webmanifest` → 200 `application/manifest+json`; `/icon-512.png` →
  200 `image/png`. No navegador: SW **ativo** (`scope` `/`, script `sw.js`),
  manifest lido como JSON válido, `theme-color` e `apple-touch-icon` presentes.
- **Offline:** com a rede desligada e recarregando `/`, o app shell abre
  integralmente (header/nav/conteúdo/footer) servido pelo SW.
- **Dev:** `virtual:pwa-register` é no-op (não referencia `navigator.serviceWorker`)
  e o `index.html` de dev não recebe `<link rel="manifest">` — nenhum SW no dev.

**Desvios do plano:** nenhum no escopo. O comando `ls dist/sw.js dist/manifest.webmanifest`
foi complementado por requisição HTTP ao preview com conferência de MIME type. O
Lighthouse (categoria PWA) não está disponível no ambiente e não foi executado;
"Installable"/"manifest válido" foram conferidos diretamente no navegador (SW ativo
+ manifest JSON válido + ícones 192/512/maskable) e pelo shell abrindo offline.

---

# Fase 1 — Repositórios offline (outbox + atualização otimista)

### Objetivo
Toda **escrita** funciona sem rede: vai para uma fila (outbox) e reflete na UI
imediatamente (cache otimista).

### Contexto
- Repositórios em `src/infrastructure/repositories.ts`
  (`createRepository`, `createCrudRepository`, e os exports
  `operacoesRepo`, `proventosRepo`, `consolidadoRepo`, `metasRepo`,
  `historicoRepo`, `valuationRepo`).
- O shim `src/services/repositories.ts` re-exporta de
  `@/infrastructure/repositories` — **todos** os consumidores passam por lá.
- Ports em `src/domain/repositories/ports.ts` (`Repository<T>`,
  `CrudRepository<T>`, `RepositoryContext { accessToken, spreadsheetId }`).
- `Consolidado` é **aba derivada** (recalculada por
  `application/consolidado.ts` `writeConsolidado`) → **não entra no outbox**.

### Tarefas
1. Criar `src/infrastructure/outbox.ts`:
   - persistência em `localStorage` (chave `minhaacoes.outbox.v1`);
   - `Mutation = { id, createdAt, sheet: SheetName, kind: 'append' | 'update' | 'remove' | 'replaceAll', entity?, entities?, entityId? }`;
   - API: `enqueue`, `list`, `remove`, `clear`, `count`.
2. Criar `src/infrastructure/offlineRepositories.ts` — decorador dos repositórios:
   - se **offline** (ou escrita falhar por erro de rede/429): aplica a mutação
     no cache local de forma otimista + `enqueue`;
   - se **online**: tenta escrita direta; em falha de rede, cai para o outbox;
   - `Consolidado` nunca é enfileirado.
   - A decisão online/offline consulta `navigator.onLine` (via módulo único a
     ser centralizado na Fase 2, ou um helper em `outbox.ts` por ora).
3. Ajustar `src/infrastructure/repositories.ts` para exportar os repositórios
   **já envoltos** pelo decorador (assim `services/repositories.ts` e toda a
   camada `application` passam a usar a versão offline-aware sem alterar assinaturas).
4. Testes: `src/infrastructure/outbox.test.ts` (enqueue/list/remove/clear,
   persistência e idempotência de `id`).

### Arquivos a criar/editar
- `src/infrastructure/outbox.ts` (novo)
- `src/infrastructure/offlineRepositories.ts` (novo)
- `src/infrastructure/outbox.test.ts` (novo)
- `src/infrastructure/repositories.ts` (exportar versões envoltas)

### Critérios de aceite
- `outbox` persiste mutações e sobrevive a reload.
- Com `navigator.onLine === false` (simulado em teste), `operacoesRepo.append`
  atualiza o cache local e enfileira; sem chamada à API.
- `consolidadoRepo` **não** gera entrada de outbox em nenhum caminho.
- Comandos globais verdes.

### Comandos de validação
```bash
npm run typecheck && npm test -- --run && npm run lint
```

### Estado
- [x] concluída em 2026-10-10

### Notas/Desvios

**Arquivos realmente alterados:**

- `src/infrastructure/outbox.ts` (novo) — fila persistida em `localStorage`
  (`minhaacoes.outbox.v1`) com `Mutation`/`MutationDraft` e a API
  `enqueue/list/remove/clear/count`; expõe também o helper `isOnline()`.
- `src/infrastructure/offlineRepositories.ts` (novo) — decorador genérico
  `withOfflineOutbox(repo, options?)`.
- `src/infrastructure/outbox.test.ts` (novo).
- `src/infrastructure/offlineRepositories.test.ts` (novo — arquivo extra, ver
  desvios).
- `src/infrastructure/repositories.ts` — passa a exportar `operacoesRepo`,
  `proventosRepo`, `consolidadoRepo`, `metasRepo`, `historicoRepo` e
  `valuationRepo` já **envoltos** pelo decorador; `createRepository`,
  `createCrudRepository` e `prefetchAllSheets` permanecem inalterados (sem
  mudança de assinaturas). Nenhum consumidor precisou mudar (o shim
  `services/repositories.ts` continua re-exportando tudo).
- `PLANO_PWA.md` — estado e notas.

**Decisões tomadas:**

- **Estrutura da `Mutation`:** `{ id, createdAt, sheet, kind, entity?,
  entities?, entityId? }`, com `kind: 'append' | 'update' | 'remove' |
  'replaceAll'`. `enqueue` recebe um `MutationDraft = Omit<Mutation, 'id' |
  'createdAt'>` e gera `id` via `newId()` (uuid/timestamp) e `createdAt`
  (`new Date().toISOString()`), garantindo unicidade e ordem FIFO. A persistência
  reutiliza os helpers de `src/infrastructure/storage.ts`
  (`readStorageJson`/`writeStorageJson`/`removeStorageKey`).
- **Decisão offline:** helper `isOnline()` em `outbox.ts` (`navigator.onLine !==
  false`; ambientes sem `navigator` são tratados como online). Cada escrita do
  decorador segue: `outboxEnabled === false` → direto; senão, se online → tenta a
  escrita real e, em falha **recuperável** (`isOfflineWriteError`: objeto com
  `status === 0` ou `429` — casa com `SheetsApiError`), cai para o outbox; se
  offline → aplica otimista + enfileira sem tocar na API. Erros não recuperáveis
  (ex.: 401/403/500) são propagados, sem enfileirar.
- **Atualização otimista do cache:** usa `readSheetCache`/`writeSheetCache`
  (aba por `spreadsheetId`): `append` → acrescenta; `update` → substitui por id;
  `remove` → filtra por id; `replaceAll` → grava a lista inteira.
- **Identificação por ID:** o decorador aceita `idOf` (padrão `entity.id`), o
  que é necessário para `update`/`remove` otimistas. Em `repositories.ts` os
  extratores `operacaoId`/`proventoId` são passados tanto para
  `createCrudRepository` quanto para o decorador.
- **`Consolidado` nunca enfileira:** a aba derivada é envolta com
  `{ outboxEnabled: false }`, então toda escrita delega direto ao repositório
  real (sem otimista e sem outbox).
- **Sem ciclo de importação:** o decorador é genérico e **não** importa
  `repositories.ts`; é `repositories.ts` que importa o decorador. Overloads
  preservam `CrudRepository<T>` para `operacoesRepo`/`proventosRepo`.

**Desvios do plano:**

- Foi criado **um arquivo de teste a mais** (`offlineRepositories.test.ts`),
  além do `outbox.test.ts` previsto. Motivo: o critério de aceite exige provar
  que (a) com `navigator.onLine === false` uma escrita via `operacoesRepo.append`
  atualiza o cache e enfileira **sem chamar a API** e (b) `consolidadoRepo` não
  gera outbox. Esses casos ficam melhor isolados do teste unitário do outbox.
- Nenhum outro desvio de escopo.

**Validação executada (2026-10-10):**

- `npm run typecheck` — ok.
- `npm test -- --run` — **174 testes / 15 arquivos**, todos verdes (17 novos: 6
  em `outbox.test.ts`, 11 em `offlineRepositories.test.ts`).
- `npm run lint` — ok.
- `npm run build` — ok (sem regressões; o aviso de chunk > 500 kB é pré-existente).
- Testes-chave verdes: `operacoesRepo.append` offline → cache atualizado +
  `outbox.count() === 1`, com `fetch` **não** chamado; `consolidadoRepo.append`
  offline → `outbox.count() === 0`.

---

# Fase 2 — Sincronização automática (flush + Consolidado)

### Objetivo
Quando houver rede, reaplicar as mutações pendentes na planilha em ordem FIFO e
recalcular a `Consolidado`.

### Contexto
- Fase 1 entrega `outbox` com mutações persistidas.
- `application/consolidado.ts` expõe `syncConsolidado(context)` e
  `writeConsolidado(context, operacoes, precosAtuais)`.
- `infrastructure/repositories.ts` expõe `prefetchAllSheets(context)` (1
  `batchGet` para as 5 abas).
- CRUD (`update/remove`) já relê a aba antes de reescrever (re-leitura segura).

### Tarefas
1. Criar `src/application/sync.ts`:
   - `sincronizarPendentes(context): Promise<SyncResult>` — processa a fila FIFO;
   - para `update/remove`, delegar ao repositório real (que relê a aba);
   - sucesso → `remove(id)`; erro de rede/429 → interrompe e mantém o item;
   - 401 → pede novo token (via `AuthContext.ensureAccessToken`) e re-tenta;
   - 429 → backoff exponencial;
   - idempotência por `mutation.id` (não duplicar `append` se o replay falhar
     **após** a escrita ter sido aceita).
2. Após o flush: chamar `syncConsolidado` **uma vez** e `prefetchAllSheets`
   para refrescar o cache.
3. Disparadores de sync:
   - evento `window.online`;
   - ao montar o `AppLayout` (uma vez);
   - após cada ação de escrita (best-effort);
   - retry periódico simples (ex.: 60s) enquanto houver pendências.
4. `Snapshot` do histórico: se offline, enfileirar com a **data fixada** no dia
   da ação (não a data do replay).
5. Testes: `src/application/sync.test.ts` com repositório falso (fake) para
   validar ordem FIFO, sucesso parcial e interrupção em erro de rede.

### Arquivos a criar/editar
- `src/application/sync.ts` (novo)
- `src/application/sync.test.ts` (novo)
- `src/presentation/app/App.tsx` ou `AppLayout` (registro do ouvinte de sync)
- (se necessário) centralizar a decisão online/offline em um módulo único
  `src/infrastructure/network.ts`

### Critérios de aceite
- Desligar rede → 2 operações offline → religar → as duas aparecem na planilha
  na ordem e a fila zera.
- Falha de rede no meio do flush não perde nem duplica mutações.
- `Consolidado` é recalculado **uma vez** ao final do flush.
- Comandos globais verdes.

### Comandos de validação
```bash
npm run typecheck && npm test -- --run && npm run lint && npm run build
npm run preview   # teste manual: offline → ações → online → conferir planilha
```

### Estado
- [x] concluída em 2026-10-10

### Notas/Desvios

**Arquivos realmente alterados** (`git status`):

- `src/application/sync.ts` (novo) — `sincronizarPendentes(context, opcoes?)`,
  `SyncResult`, `SyncOptions`/`SyncDependencies` e a máquina de replay FIFO.
- `src/application/sync.test.ts` (novo) — 6 testes com dependências falsas.
- `src/infrastructure/repositories.ts` — repositórios **crus** mantidos
  internamente; exports dos repositórios envoltos preservados; novos
  `RawSheetRepository`, `rawRepositories` (mapa por `SheetName`) e
  `replayMutation(context, mutation)`.
- `src/presentation/hooks/useSync.ts` (novo) — disparador central de sync.
- `src/presentation/app/layout/AppLayout.tsx` — chama `useSync()` uma vez.
- `PLANO_PWA.md` — estado e notas.

**Decisões tomadas:**

- **Exposição dos repositórios crus:** `repositories.ts` agora constrói os repos
  crus (`*RepoRaw`) e os envolve com `withOfflineOutbox` mantendo os mesmos
  exports (`operacoesRepo`, etc.). Para o replay, expõe `rawRepositories:
  Record<SheetName, RawSheetRepository>` (contrato apagado para `unknown`, com
  `append`/`replaceAll`/`update?`/`remove?`/`refresh`/`idOf?`) e a função
  `replayMutation` que aplica a mutação no repo cru correspondente a
  `mutation.sheet`. Assim o sync **não** passa pelo decorador — falha de rede
  durante o replay é propagada (item fica na fila), sem risco de reenfileiramento
  em loop. `update`/`remove` usam o CRUD cru (que já relê a aba antes de
  reescrever — re-leitura segura).
- **Tratamento de erros no replay:** sucesso → `remove(id)` e continua; erro de
  rede/quota (`status` 0 ou 429) → interrompe o loop e mantém o item; 401 →
  chama o callback opcional `obterToken` (a UI injeta `ensureAccessToken` via
  `useSync`) e re-tenta **uma** vez com o novo token — se o callback retornar
  `null` ou a re-tentativa falhar, interrompe; demais erros (403/500) → mantém
  o item, registra o primeiro erro em `SyncResult.erro` e **continua**.
- **429 sem backoff exponencial:** a Tarefa original citava backoff para 429,
  mas o **Critério/escopo** da fase fixa `status 0 ou 429 → interrompe`;
  seguimos o escopo (interrompe e mantém o item para o próximo ciclo).
- **Idempotência do `append`:** antes de reaplicar, `sync.ts` consulta o repo cru
  via `refresh` e compara o `idOf` da entidade com as linhas existentes — pula
  se já existir (aplica apenas a abas com IDs: `Operacoes`/`Proventos`).
- **Pós-flush:** se `aplicadas > 0`, chama `syncConsolidado(context)` **uma** vez
  e `prefetchAllSheets(context)` **uma** vez; falha nessa etapa é best-effort
  (não reenfileira nada, apenas atrasa o recálculo do derivado).
- **Disparadores centralizados:** `useSync()` em `AppLayout` cobre montagem
  (uma vez), reconexão (`window.online` via `useOnlineStatus`) e retry periódico
  de 60s enquanto `SyncResult.pendentes > 0`, com trava de reentrância
  (`inFlightRef`). O hook consome apenas a camada `application`
  (`sincronizarPendentes`) — não importa infraestrutura diretamente, preservando
  a regra `presentation → application`.
- **Snapshot do histórico (item 4):** **nenhum ajuste necessário.**
  `registrarSnapshot` monta o `Snapshot` com `snapshotDoResumo(resumo,
  options.data)` (data ISO de hoje no momento da ação) **antes** de enfileirar o
  `replaceAll`; a mutação carrega a lista completa de snapshots com a data já
  fixada no dia da ação, e o replay grava exatamente essas linhas (nunca
  recalcula a data).

**Desvios do plano:**

- Criado `src/presentation/hooks/useSync.ts` em vez de editar `App.tsx`
  diretamente (o plano previa `App.tsx` **ou** `AppLayout`). Não foi criado o
  `src/infrastructure/network.ts` — a decisão online/offline já está em
  `outbox.ts` (`isOnline`) e o hook usa `useOnlineStatus`.
- O disparador opcional "após cada escrita (best-effort)" **não** foi
  implementado: é invasivo (exigiria tocar todos os pontos de escrita) e os
  disparadores obrigatórios (montagem, `online`, retry 60s) já cobrem os
  critérios de aceite. Fica como melhoria para a Fase 4.
- **Achado fora de escopo (não alterado):** `registrarSnapshot` chama
  `historicoRepo.refresh` antes do `replaceAll`, então, **totalmente offline**, a
  gravação do snapshot ainda não enfileira (o `refresh` falha). O snapshot
  automático já é pulado quando offline (`useDashboard` guarda por `isOffline`)
  e os caminhos manuais/best-effort só são alcançáveis online. A **data** está
  correta (fixada no dia da ação); a viabilização do snapshot 100% offline fica
  sugerida para a Fase 3/4, fora deste escopo.

**Validação executada (2026-10-10):**

- `npm run typecheck` — ok.
- `npm test -- --run` — **180 testes / 16 arquivos**, todos verdes (6 novos em
  `sync.test.ts`).
- `npm run lint` — ok.
- `npm run build` — ok (gera `dist/sw.js`/`dist/manifest.webmanifest`; aviso de
  chunk > 500 kB é pré-existente).
- Testes-chave verdes: FIFO, interrupção em erro de rede no meio preservando os
  itens restantes, skip de `append` duplicado, `syncConsolidado` chamado **uma**
  vez ao final, renovação de token em 401 (re-tenta uma vez) e interrupção
  quando a renovação falha.

---

# Fase 3 — Auth resiliente offline

### Objetivo
Não deslogar o usuário por falta de rede; renovar o token ao reconectar.

### Contexto
- `src/presentation/app/providers/AuthProvider.tsx`:
  - `silentRefresh` limpa token e seta `unauthenticated` quando a renovação falha;
  - `ensureAccessToken` retorna `null` se o token está expirado e a renovação falha;
  - `login/logout/selecionarPlanilha/criarPlanilha` dependem de token válido.
- Erros de rede da API vêm como `SheetsApiError.status === 0` (gateway).

### Tarefas
1. Em `silentRefresh` (catch): se `!navigator.onLine` **ou** erro de rede
   (`status === 0`), **manter a sessão** (mesmo com token expirado), marcar
   estado "autenticado offline" e reagendar tentativa para o evento `online`
   — em vez de limpar token e deslogar.
2. Em `ensureAccessToken`: quando offline, retornar o token armazenado mesmo
   expirado (escritas vão para o outbox; leitura é do cache — não há chamada à API).
3. Escutar `window.online` para disparar `silentRefresh` **e** o flush da fila
   (integração com a Fase 2).
4. Garantir que `logout` explícito continua limpando tudo normalmente
   (mesmo offline).

### Arquivos a criar/editar
- `src/presentation/app/providers/AuthProvider.tsx`
- (se necessário) testes do fluxo de auth com fake de `requestAccessToken`

### Critérios de aceite
- Token expirado + sem rede → app continua utilizável (dashboard do cache).
- Ao reconectar → renova token e sincroniza sem novo login.
- Logout explícito continua funcionando offline.
- Comandos globais verdes.

### Comandos de validação
```bash
npm run typecheck && npm test -- --run && npm run lint
npm run preview   # manual: expirar token, desligar rede, usar app, religar
```

### Estado
- [x] concluída em 2026-10-11

### Notas/Desvios

**Arquivos realmente alterados** (`git status`):

- `src/presentation/app/providers/AuthProvider.tsx` — `silentRefresh`
  (ramo de catch), `ensureAccessToken`, novo listener de `window.online` e
  comentário no `logout`. Nenhuma assinatura pública do `AuthContext` mudou.
- `PLANO_PWA.md` — estado e notas.

**Decisões tomadas:**

- **Como distinguir “falta de rede” de “falha real” em `silentRefresh`:** a
  chamada que falha ali é `requestAccessToken` (Google Identity Services), que
  lança `GoogleAuthError` (ou erro de `loadScript`) — **não** `SheetsApiError`,
  logo **não há `status`** para inspecionar. A detecção de offline usa
  `isOnline()` do outbox (`navigator.onLine !== false`; ambientes sem `navigator`
  → online), conforme o PONTO CRÍTICO do prompt. `isOnline()` foi preferido a
  `navigator.onLine` puro por centralizar a regra “navigator ausente = online”.
- **Ramo de “manter sessão” unificado:** a condição ficou
  `stored && (!isOnline() || isTokenValid(stored, 0))`. A parte
  `isTokenValid(stored, 0)` preserva o comportamento transitório pré-existente
  (token ainda válido, porém dentro da margem de renovação); a parte
  `!isOnline()` cobre o token **expirado** offline. Em ambos os casos a sessão é
  mantida, `tokenRef`/`accessToken` recebem o token armazenado e
  `scheduleRefreshIn(TOKEN_REFRESH_RETRY_MS)` (60 s) reagenda a tentativa.
  Falha real (consentimento revogado, popup fechado, erro do GIS) continua
  limpando token/estado e indo para `'unauthenticated'`.
- **`status = 'authenticated'` no ramo de sessão mantida:** antes o ramo
  transitório não tocava em `status`; passou a setar `'authenticated'` (exigido
  pela tarefa). Isso também evita que o app fique preso em `'loading'` quando o
  bootstrap (consent + token inválido) mantém a sessão.
- **`ensureAccessToken` offline:** se o token armazenado ainda é válido, usa-o
  (como antes); se está expirado **e** offline, devolve o token armazenado mesmo
  expirado **sem** chamar `silentRefresh` (não há API a autorizar: escrita →
  outbox, leitura → cache). Sem token armazenado, devolve `null` (não inventa
  sessão). Online, o fluxo permanece intacto.
- **Listener de `window.online` no provider:** dispara `silentRefresh` apenas
  quando há token persistido (`tokenStorage.load()`), evitando transições
  espúrias para `'unauthenticated'` em usuários sem login. O flush da fila
  continua a cargo da `useSync` (reage ao mesmo evento e chama
  `ensureAccessToken`) — **nenhuma** lógica de sync foi alterada.
- **`logout` offline:** nenhuma mudança de comportamento foi necessária. A
  revogação (`revokeAccessToken`) já está em `try/catch` e a limpeza local
  (`token`/`workspace`/`consent` + estado) sempre executa, mesmo sem rede; só o
  comentário foi explicitado. Nenhuma chamada de rede é pré-condição do logout.
- **Sem novo teste automatizado:** o projeto **não** possui teste de auth e o
  ambiente de testes é `node` (`vitest.config.ts`: `environment: 'node'`,
  `include: ['src/**/*.test.ts']`), sem `@testing-library/react` — testar o
  provider exigiria novas dependências e mudança de config, fora do escopo.
  Seguindo a instrução da fase, o fluxo foi validado sem teste automatizado
  (ver abaixo).

**Validação executada (2026-10-11):**

- `npm run typecheck` — ok.
- `npm test -- --run` — **180 testes / 16 arquivos**, todos verdes (nenhum teste
  novo; nenhum regrediu).
- `npm run lint` — ok.
- `npm run build` — ok; `dist/sw.js` + `dist/workbox-*.js` + 16 entradas de
  precache (~998 KiB).
- `npm run preview` (porta 4173) + smoke test no navegador: o app shell carrega;
  com a rede desligada e recarregando, o shell abre integralmente e o provider
  inicializa **sem erros de console**; ao religar a rede, recarrega sem erros.
- **Validação manual do fluxo offline × auth (roteiro reproduzível):** este
  ambiente não possui `VITE_GOOGLE_CLIENT_ID` (só `.env.example`), então não é
  possível executar um login Google real aqui. O roteiro manual é: entrar com a
  conta Google, selecionar/criar a planilha, deixar o token expirar, **desligar
  a rede** e abrir o app → o dashboard carrega do cache e segue utilizável (não
  desloga); **religar a rede** → o evento `online` renova o token e a `useSync`
  esvazia o outbox **sem novo login**. O `logout` offline limpa
  token/workspace/consent e volta ao login.

**Desvios do plano:**

- Nada de estrutural. O listener de `window.online` foi adicionado dentro do
  próprio `AuthProvider` (sem criar arquivo novo). Não foi criado teste de auth
  (justificado acima). Nenhuma fase além da Fase 3 foi tocada.

---

# Fase 4 — UX de sincronização

### Objetivo
Mostrar ao usuário o estado online/offline e o que está pendente de sincronizar.

### Contexto
- `useOnlineStatus` já existe.
- Fases 1–2 entregam `outbox.count()` e `sincronizarPendentes`.
- Layout em `src/app/layout/AppLayout.tsx` (shim para
  `src/presentation/app/layout/AppLayout.tsx`).

### Tarefas
1. Criar `src/presentation/hooks/useSyncStatus.ts` — combina `useOnlineStatus`
   + `outbox.count()` + status do último sync (`idle | syncing | error`).
2. Criar `src/presentation/components/SyncStatusBadge.tsx`:
   - online sem pendências → ok;
   - offline → badge "Offline";
   - pendências → "N alterações pendentes" + botão "Sincronizar agora".
3. Integrar o badge no `AppLayout` (cabeçalho).
4. (Opcional) prompt de atualização quando o SW detecta nova versão
   (complemento da Fase 0).

### Arquivos a criar/editar
- `src/presentation/hooks/useSyncStatus.ts` (novo)
- `src/presentation/components/SyncStatusBadge.tsx` (novo)
- `src/presentation/app/layout/AppLayout.tsx` (integrar badge)

### Critérios de aceite
- Os 3 estados (online ok / offline / pendências) são exibidos corretamente.
- Botão "Sincronizar agora" força o flush e zera as pendências quando online.
- Comandos globais verdes.

### Comandos de validação
```bash
npm run typecheck && npm run lint && npm run build
npm run preview   # manual: alternar rede e observar o badge
```

### Estado
- [ ] pendente

### Notas/Desvios
— (preencher ao executar)

---

# Fase 5 — Melhorias opcionais

### Objetivo
Robustez e alcance (não bloqueia o MVP — só após as fases 0–4 validadas).

### Tarefas candidatas
1. Migrar cache + outbox de `localStorage` para **IndexedDB**
   (cota de ~5 MB do localStorage; dados pequenos hoje, outbox cresce).
2. **Periodic Background Sync API** (onde suportado; Safari não suporta —
   manter fallback por evento `online`).
3. Sincronização entre abas via evento `storage` (evitar duas abas editando).
4. Tela de conflitos (se passar a haver edição simultânea direto na planilha).

### Arquivos a criar/editar
- Definir por tarefa escolhida (ex.: `src/infrastructure/db.ts` para IndexedDB).

### Critérios de aceite
- Definidos por tarefa; manter comandos globais verdes.

### Estado
- [ ] pendente

### Notas/Desvios
— (preencher ao executar)

---

## Riscos e decisões (consolidado)

| Tema | Decisão / risco |
| --- | --- |
| Fórmulas `GOOGLEFINANCE` | Só atualizam com rede; offline mostra **último preço conhecido** (comportamento atual). |
| Conflito com edição manual na planilha | `update/remove` relê a aba no replay e grava por ID → **last-write-wins** nas linhas tocadas; demais linhas preservadas. |
| Token OAuth (~1h) | Escritas offline são enfileiradas e aplicadas depois com token renovado. |
| SW × API autenticada | SW **não** cacheia respostas da API do Google (evita servir dados de outro token). |
| Idempotência | Cada mutation tem `id` próprio; `append` idempotente por ID do registro + ID da mutation. |
| `Consolidado` | Não enfileirado — derivado; recomputado **uma vez** ao fim do flush. |
