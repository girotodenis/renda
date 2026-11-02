# Execução do PLANO_CRIPTOGRAFIA.md

> Documento de acompanhamento da execução do
> [`PLANO_CRIPTOGRAFIA.md`](./PLANO_CRIPTOGRAFIA.md).
>
> Regras de trabalho:
> - uma fase por vez, sempre da Fase 2 em diante (a Fase 1 depende do Google);
> - cada fase termina com `npm run typecheck`, `npm test -- --run` e
>   `npm run lint` verdes **e** um commit local próprio;
> - o que não puder ser validado automaticamente fica registrado em
>   "Validação manual pendente".

---

## Status geral

| Fase | Descrição | Status | Commit |
| --- | --- | --- | --- |
| 0 | Decisões e textos | ✅ concluída (no plano) | — |
| 1 | Validação do escopo Google | ⏸️ pendente (manual, não bloqueante) | — |
| 2 | Núcleo criptográfico | ✅ concluída | `Fase 2` |
| 3 | Container e gateway JSON | ✅ concluída | `Fase 3` |
| 4 | Abertura, bloqueio e sessão | ✅ concluída | `Fase 4` |
| 5 | Configurações e criação | ✅ concluída | `Fase 5` |
| 6 | Modo local cifrado | ✅ concluída | `Fase 6` |
| 7 | Planilha de cotações | ✅ concluída | `Fase 7` |
| 8 | Backend `json` padrão + migração | ✅ concluída | `Fase 8` |
| 9 | Diagnóstico, docs e memória | ✅ concluída | `Fase 9` |

Legenda: ⏳ a fazer · 🔄 em andamento · ✅ concluída · ⚠️ concluída com pendência · ⏸️ bloqueada/pendente manual

---

## Fase 1 — Validação do escopo Google ⏸️

- [ ] Provar `drive.file` + Sheets API (criar/ler/escrever planilha).
- [ ] Confirmar `GOOGLEFINANCE` retornando número (`;` × `,`).
- [ ] Registrar o resultado neste arquivo.

**Situação:** não é executável no ambiente de desenvolvimento (exige consentimento
OAuth no navegador e uma conta Google com Drive). O plano marca a fase como
**não bloqueante**: se falhar, a planilha de cotações fica `indisponível` e a
entrega segue pelas APIs (Brapi → Mais Retorno).

---

## Fase 2 — Núcleo criptográfico

- [ ] `domain/criptografia.ts`
- [ ] `infrastructure/cripto/webCrypto.ts`
- [ ] `infrastructure/cripto/envelope.ts`
- [ ] `infrastructure/cripto/chaveSessao.ts`
- [ ] testes (`domain/criptografia.test.ts`, `infrastructure/cripto/envelope.test.ts`)

**Aceite:** round-trip; chave errada/adulteração falham; cabeçalho válido.

**Resultado:** ✅ concluída.

Arquivos criados:
- `src/domain/criptografia.ts` — magic `MINHASACOES-ENC1`, versão, nomes de KDF/cifra,
  `KDF_ITERACOES = 600_000`, `SALT_BYTES = 16`, `IV_BYTES = 12`, `validarChave`
  (só rejeita vazia), `montarCabecalho`/`parseCabecalho` (com faixa de iterações
  aceita na leitura: 1.000–10.000.000), Base64 próprio, `temMagic` e
  `criptografiaDoArquivo` (detecção **só** pelo magic).
- `src/infrastructure/cripto/webCrypto.ts` — `isCriptografiaSuportada`,
  `gerarBytesAleatorios`, `derivarChave` (PBKDF2-HMAC-SHA256, chave AES-256
  não-extraível), `cifrarBytes`/`decifrarBytes` (AES-256-GCM, tag 128 bits).
- `src/infrastructure/cripto/envelope.ts` — `SessaoCripto` (chave + salt +
  iterações, para recifrar com o mesmo cabeçalho), `estaCifrado`, `lerCabecalho`,
  `criarSessao`, `cifrarArquivo`, `decifrarArquivo`, `abrirComSenha`,
  `ChaveIncorretaError`, `ChaveNecessariaError`. AAD = magic + cabeçalho + `\n`.
- `src/infrastructure/cripto/chaveSessao.ts` — `Map<spreadsheetId, SessaoCripto>`
  em memória (nunca persistida).
- `src/infrastructure/cripto/index.ts` — pacote que reexporta tudo.
- Testes: `domain/criptografia.test.ts` (21) e `infrastructure/cripto/envelope.test.ts` (23).

Decisões tomadas na execução:
- `parseCabecalho` devolve o texto exato do cabeçalho (`json`) para o AAD usar os
  bytes reais em vez de uma remontagem.
- `decifrarArquivo` converte **qualquer** falha (formato ou tag) em
  `ChaveIncorretaError` — a UI tem uma mensagem só e não se revela qual byte
  falhou.
- Testes usam 1.000 iterações (`criarSessao(senha, { iteracoes: 1000 })`) para
  não pesar a suíte; produção continua em 600.000.

Validação: 52 arquivos / 532 testes verdes, `tsc --noEmit` e `eslint .` limpos.

---

## Fase 3 — Container e gateway JSON

- [ ] `driveFile/container.ts`
- [ ] `driveFile/gateway.ts`: `Entry.criptografado`, `fetchEntry` decifrando,
      `uploadDatabase` recifrando, `resolveConflict`, `createDefaultSpreadsheet(opcoes.chave)`,
      `alterarCriptografia`, `estadoCriptografia`, `loadSpreadsheetWorkspace` com `criptografia`
- [ ] `sheets/gatewayRouter.ts`: repasses + `criptografiaDisponivel()`
- [ ] testes de compatibilidade com arquivos em claro e conflito 412

**Aceite:** banco antigo abre igual; banco cifrado só abre com a chave; 412
resolve cifrado; arquivo no Drive deixa de ser gzip legível.

**Resultado:** ✅ concluída.

Arquivos:
- `src/infrastructure/driveFile/container.ts` (**novo**) — `codificarBanco(sheets, version, sessao)`
  (comprime e depois cifra) e `decodificarBanco(bytes, chave)` →
  `{ raw, criptografado }`; detecção **só** por magic; `ChaveNecessariaError`
  sem chave; `DatabaseFileError` para gzip/JSON inválidos.
- `src/domain/workspace.ts` — `CriptografiaBanco = 'nenhuma' | 'total'` e
  `SpreadsheetWorkspace.criptografia?`.
- `src/infrastructure/driveFile/gateway.ts` — `Entry.criptografado`;
  `fetchEntry` decifra pela chave da sessão; `uploadDatabase` **lança** se o
  arquivo está cifrado e a chave sumiu (nunca grava em claro);
  `resolveConflict` herda o estado do remoto e mantém cifrado;
  `createDefaultSpreadsheet(token, title?, { chave })` nasce cifrado e já
  desbloqueado; `alterarCriptografia(token, id, chave | null)` relê o Drive e é
  idempotente; `estadoCriptografia(token, id)` →
  `{ estado, bloqueado }`. `toSheetsError` preserva
  `ChaveNecessariaError`/`ChaveIncorretaError` (não são falhas de rede).
- `src/infrastructure/sheets/gatewayRouter.ts` — `OpcoesCriarWorkspace`,
  repasses de `alterarCriptografia`/`estadoCriptografia`, erro 400 no backend
  `sheets` (mensagem da seção 6.7) e `criptografiaDisponivel()` =
  `isJsonBackend() && isCriptografiaSuportada()`.
- Testes: `driveFile/container.test.ts` (9), +8 casos em `driveFile/gateway.test.ts`
  e +2 em `sheets/gatewayRouter.test.ts`.

Validação: 53 arquivos / 552 testes verdes, `tsc --noEmit` e `eslint .` limpos.

Pendência consciente: o modo local ainda recusa `alterarCriptografia` (400) e
`criptografiaDisponivel()` não considera o modo local — a Fase 6 fecha isso.

---

## Fase 4 — Abertura, bloqueio e sessão

- [ ] `AuthProvider`/`authContext` (`'bloqueado'`, desbloquear, bloquear, limpeza de chaves)
- [ ] `RouteGuards` + `DesbloquearBanco` (nome do banco)
- [ ] `AbrirBancoModal` em 2 passos
- [ ] `CampoSenha`, `ModalSenha`, `BadgeProtegido`
- [ ] `cripto/verificadorLocal.ts` + desbloqueio offline
- [ ] confirmação obrigatória no "Bloquear agora"
- [ ] `useSync`/`SyncStatusBadge` respeitando o bloqueio

**Aceite:** abrir → senha → dashboard; reload online e offline pede a chave;
cancelar não troca o banco ativo; bloqueio confirma; logout esquece chaves;
"Bloquear agora" limpa o cache.

**Resultado:** ✅ concluída.

Arquivos:
- `src/infrastructure/cripto/verificadorLocal.ts` (**novo**) — verificador por
  banco no IndexedDB (`cripto-verificador::<id>`): `guardarVerificador`,
  `abrirVerificador` (senha errada → `null`), `temVerificador`,
  `esquecerVerificador`, `esquecerTodosOsVerificadores`. Só parâmetros do KDF +
  bloco fixo cifrado; senha e chave jamais são gravadas.
- `src/infrastructure/driveFile/gateway.ts` — `desbloquear(token, id, senha)`:
  só cacheia e guarda a chave **depois** de decifrar; senha errada não altera
  nada. `gatewayRouter` repassa (400 fora do backend `json`).
- `src/domain/workspace.ts` — `AuthStatus` ganha `'bloqueado'`.
- `src/presentation/app/providers/authContext.ts` + `AuthProvider.tsx` —
  `desbloquearBanco(senha, id?)`, `bloquearBanco()`, `esquecerBanco()`,
  `criptografiaDoBanco`, `abrirBancoPorId` agora devolve
  `ResultadoAberturaBanco` (`aberto` | `chave-necessaria` | `erro`),
  `criarBanco(title, { force, chave })`. Bootstrap bloqueia antes de ler dados;
  desbloqueio online usa o arquivo, offline usa o verificador; logout e troca de
  banco esquecem chaves; bloqueio sincroniza a fila (best effort), invalida o
  cache de abas e esquece a chave.
- `src/presentation/app/routes/RouteGuards.tsx` — `'bloqueado'` renderiza a tela
  de desbloqueio nos dois guards.
- `src/presentation/features/auth/DesbloquearBanco.tsx` (**novo**) — nome do
  banco, senha com autofocus/Enter, spinner, atraso 0/1/2/5 s, "Esquecer este
  banco", "Usar sem Google", aviso de Web Crypto.
- `src/presentation/features/auth/AbrirBancoModal.tsx` — 2 passos (lista →
  senha) sem trocar o banco ativo quando a chave não é aceita.
- `src/presentation/components/CampoSenha.tsx`, `ModalSenha.tsx`,
  `BadgeProtegido.tsx` (**novos**) — campo com olho/erro/Enter, casca genérica
  de modal de senha e indicador `🔒 Protegido` no header com "Bloquear"
  (confirmação obrigatória e aviso de pendências).
- `src/presentation/hooks/useSync.ts` + `SyncStatusBadge.tsx` — não sincronizam
  bloqueado e retomam após o desbloqueio.
- Testes: `cripto/verificadorLocal.test.ts` (9) e +5 casos no gateway/router.

Validação: 54 arquivos / 566 testes verdes, `tsc --noEmit`, `eslint .` e
`vite build` limpos.

---

## Fase 5 — Configurações e criação

- [ ] `application/criptografia.ts`
- [ ] `Switch.tsx`, `SegurancaBancoCard`, `ModalSenha` (ativar/desativar/bloquear)
- [ ] checkbox "Criar banco criptografado" no `WorkspaceSetup`
- [ ] "Entendi que não há recuperação" obrigatório + backup `.ods`

**Aceite:** toggle reflete o estado real; botões desabilitados sem senha,
confirmação igual e "Entendi" marcado; mensagens da seção 6.7 corretas.

**Resultado:** ✅ concluída.

Arquivos:
- `src/application/criptografia.ts` (**novo**) — `estadoDoBanco`,
  `motivoCriptografiaIndisponivel` (uma única fonte das mensagens da 6.7),
  `ativarCriptografia` (senha → `criarSessao` → `alterarCriptografia` →
  verificador), `desativarCriptografia` (exige chave na sessão, esquece
  chave/verificador), `bloquearBanco(context, deps)` (flush best effort + limpeza
  do cache + esquecimento da chave) e `ErroCriptografiaIndisponivel`.
  Pré-condições: Web Crypto, backend (`json` ou local), **online** e **fila
  vazia**.
- `src/presentation/components/Switch.tsx` (**novo**) — `role="switch"`,
  `aria-checked`, teclado, `disabled`/`pending`.
- `src/presentation/features/configuracoes/SegurancaBancoCard.tsx` (**novo**) —
  estado real relido no mount (`🔒`/Sem criptografia/Bloqueado), ativação com
  senha + confirmação + "Entendi que não há recuperação" + backup `.ods`,
  desativação com confirmação explícita, "Bloquear agora" com aviso de
  pendências e o aviso "O arquivo .ods é exportado sem criptografia.".
- `AuthProvider`/`authContext` — `ativarCriptografia`, `desativarCriptografia`,
  `recarregarEstadoCriptografia`; `bloquearBanco` passa a delegar ao caso de uso
  (sem duplicação).
- `WorkspaceSetup.tsx` — checkbox "Criar banco criptografado" com senha,
  confirmação, "Entendi" obrigatório, `criarSessao` só no clique (spinner) e
  sessão preservada no fluxo de nome duplicado.
- Testes: `application/criptografia.test.ts` (18, com `vi.mock`).

Validação: 55 arquivos / 584 testes verdes, `tsc --noEmit`, `eslint .` e
`vite build` limpos.

Pendência consciente: `motivoCriptografiaIndisponivel()` ainda mostra a
mensagem do backend no modo local — a Fase 6 habilita o cofre local.

---

## Fase 6 — Modo local cifrado

- [ ] `cripto/localCofre.ts`
- [ ] `localSheets` assíncrono
- [ ] `localGateway` com `await` + `ChaveNecessariaError`
- [ ] bloqueio/desbloqueio do workspace `local`

**Aceite:** abas cifradas no IndexedDB (sem texto legível), exporta `.ods` com
aviso, suíte local verde.

**Resultado:** ✅ concluída.

Arquivos:
- `src/infrastructure/cripto/localCofre.ts` (**novo**) — `ID_COFRE_LOCAL`,
  `temCofreLocal`, `criarCofreLocal`, `abrirCofreLocal`, `removerCofreLocal`.
  O cofre **é** o verificador sob o id `local`: nenhuma lógica de KDF/AES-GCM
  foi duplicada e a chave só vai para `chaveSessao`.
- `src/infrastructure/sheets/localSheets.ts` — API **assíncrona** e cifra por
  aba: com cofre ativo o valor persistido é `{ v: 1, iv, dados }`
  (AES-256-GCM, IV novo, AAD = bytes de `local-sheet::<aba>`); sem chave
  `writeLocalSheet` lança `ChaveNecessariaError` (nunca grava em claro) e
  `readLocalSheet` também; matriz pura com cofre ativo é tratada como estado
  inconsistente (nunca devolve dados em claro). Sem cofre, comportamento
  idêntico ao anterior.
- `src/infrastructure/sheets/localGateway.ts` — `await` em tudo;
  `localLoadWorkspace` inclui `criptografia` a partir do cofre e não tenta
  garantir cabeçalhos no banco bloqueado.
- `src/infrastructure/sheets/gatewayRouter.ts` — `criptografiaDisponivel()` =
  `(isJsonBackend() || isModoLocal()) && isCriptografiaSuportada()`;
  `estadoCriptografia`/`alterarCriptografia` no modo local (ativar/desativar
  regravam todas as abas, idempotentes) e `desbloquear` pela senha do cofre.
- `src/application/criptografia.ts` — no modo local não exige online nem fila
  vazia (decisão "Local: funciona offline") e `motivoCriptografiaIndisponivel`
  deixa de bloquear o modo local.
- `AuthProvider` — "Esquecer este banco" também limpa as abas locais quando o
  cofre local existe (sem o cofre os envelopes ficariam órfãos).
- Testes novos: `cripto/localCofre.test.ts` (7),
  `infrastructure/sheets/localSheets.test.ts` (14); estendidos
  `localGateway.test.ts` (12), `gatewayRouter.test.ts` (9),
  `application/criptografia.test.ts` (20) e os testes de aplicação que leem as
  abas locais.

Assinaturas (síncrono → assíncrono): `readLocalSheet`, `writeLocalSheet`,
`ensureLocalSheetsWithHeaders`, `readSheetRange`, `writeSheetRange`,
`appendValuesToSheet`, `clearSheetRange`.

Validação: 57 arquivos / 613 testes verdes, `tsc --noEmit` e `eslint .` limpos.

---

## Fase 7 — Planilha de cotações

- [ ] `cotacoes/planilhaGoogle/api.ts`, `planilha.ts`, `index.ts`
- [ ] `accessToken` nas opções de consulta
- [ ] registro na cadeia antes de Brapi
- [ ] card de status/autorização em Configurações
- [ ] testes dos três estados e do fallback

**Aceite:** autorizada → preço da planilha; negada/403 → APIs; dashboard igual
nos dois casos.

**Resultado:** ✅ concluída.

Arquivos:
- `src/infrastructure/cotacoes/planilhaGoogle/api.ts` (**novo**) — Sheets API v4
  (criar/descobrir planilha, `values.get`, `values.update` `USER_ENTERED`,
  metadados/aba), `PlanilhaCotacoesError` com `isEscopoInsuficiente`/
  `isNaoEncontrada`, timeout e contador de requisições.
- `.../planilha.ts` (**novo**) — `garantirPlanilha` (id salvo em
  `localStorage` → descoberta no Drive → criação com cabeçalho),
  `reconciliarTickers` (união ordenada; só regrava quando muda, com as fórmulas
  `GOOGLEFINANCE` via `sheetFormulas.ts`) e `lerCotacoes` (um `values.get` por
  sync; parse tolerante a `#N/A`, vazio, texto, `0` e preço < R$ 0,20).
- `.../index.ts` (**novo**) — `integracaoPlanilhaGoogle` (`exigeToken: false`,
  `b3`), estado memorizado `ativa | nao-autorizada | indisponivel` +
  `estadoPlanilhaGoogle()`, cache diário no `kvStore` e `limparCache()`.
  Contrato respeitado: **nunca lança**; sem token/escopo devolve tudo em
  `semCotacao` sem rede; 403/404/rede memorizam o estado.
- `src/application/planilhaCotacoes.ts` (**novo**) — `estadoPlanilhaCotacoes`,
  `autorizarPlanilhaCotacoes` (consentimento explícito; `isUserCancellation` →
  `negada`, sem lançar), `desconectarPlanilhaCotacoes` e a mensagem da 6.7.
- `googleConfig.ts` — `SHEETS_SCOPE`, `SCOPES_COM_PLANILHA`, `tokenTemEscopo`.
- `domain/provedoresCotacao.ts` — `OpcoesConsultaCotacoes.accessToken?`.
- `cotacoes/registro.ts` — ordem `Planilha → Brapi → Mais Retorno`.
- `application/dashboard.ts` — passa `context.accessToken` às consultas.
- `PlanilhaCotacoesCard.tsx` (**novo**) + `ConfiguracoesPage.tsx` — estado,
  "Autorizar planilha de cotações" e "Desconectar"; negado não insiste.
- Testes: `planilhaGoogle/planilha.test.ts` (13), `planilhaGoogle/index.test.ts`
  (7), `application/planilhaCotacoes.test.ts` (4).

Validação: 60 arquivos / 637 testes verdes, `tsc --noEmit` e `eslint .` limpos.

---

## Fase 8 — Backend `json` padrão + migração

- [ ] `GOOGLE_BACKEND` padrão `json`; `.env.example`/README
- [ ] `application/migrarPlanilha.ts` + tela de oferta + idempotência
- [ ] migração manual via `.ods` quando o escopo for negado

**Aceite:** build padrão usa o cofre; banco antigo migra sem perda; planilha
antiga permanece intacta.

**Resultado:** ✅ concluída.

Arquivos:
- `googleConfig.ts` — `GOOGLE_BACKEND` passa a ser **`json` por padrão**
  (`VITE_GOOGLE_BACKEND=sheets` para o build alternativo, sem criptografia).
- `.env.example` e `README.md` — `json` como padrão, escopos por backend,
  escopo incremental da planilha de cotações e migração automática.
- `src/application/migrarPlanilha.ts` (**novo**) — `detectarBancoLegado`
  (build `json` + `spreadsheetUrl` em `docs.google.com/spreadsheets/d/…`),
  `migrarPlanilhaAntiga(context, { chave?, title? })` → `migrado` /
  `ja-existia` / `erro`. Lê a planilha antiga **só** pela Sheets API
  (`FORMULA`, intervalo `A1:ZZ`, com fallback aba a aba quando falta uma aba do
  schema), cria o cofre (opcionalmente cifrado) e grava as abas com um
  `batchUpdateValues`.
  - **Sem perda:** preserva a linha 1 da planilha antiga (nomes editados e
    colunas extras), completa só o sufixo do cabeçalho do schema e não trunca
    linhas de dados.
  - **Idempotente de verdade:** cofre já existente e **com dados** → abre e
    devolve `ja-existia`; cofre **vazio** (migração interrompida) → continua a
    migração no mesmo arquivo e devolve `migrado`; cofre cifrado sem chave →
    mensagem própria.
  - **Nunca** escreve, altera ou apaga a planilha antiga.
- `src/presentation/features/auth/MigrarPlanilha.tsx` (**novo**) + montagem no
  `AppLayout` — oferta única por banco legado (dispensa persistida em
  `minhaacoes.migracao.v1.dispensada`), com opção de criar o cofre cifrado e
  caminho manual via `.ods` quando o Google nega o escopo.
- `AuthProvider`/`authContext` — `migrarPlanilhaAntiga` e `dispensarMigracao`.
- Testes: `application/migrarPlanilha.test.ts` (12).

Validação: 61 arquivos / 650 testes verdes, `tsc --noEmit`, `eslint .` e
`vite build` limpos.

---

## Fase 9 — Diagnóstico, docs e memória

- [x] diagnóstico (criptografia + planilha)
- [x] `ARCHITECTURE.md`, `README.md`
- [x] memória do repositório

**Resultado:** ✅ concluída.

Arquivos:
- `src/application/diagnostics.ts` — `DiagnosticCriptografia`,
  `DiagnosticPlanilhaCotacoes`, `DiagnosticAmbiente` e
  `lerDiagnosticoAmbiente(context | null)` (lê o estado **sem escrever**; a
  leitura do estado da cifra fica em `try/catch`, então offline/403 nunca
  derrubam o diagnóstico). O relatório passa a carregar o ambiente.
- `src/presentation/features/diagnostico/DiagnosticoPage.tsx` — seção
  "Estado do ambiente" com Estatísticas de **Criptografia**
  (Sem criptografia / Arquivo criptografado / Bloqueado) e **Planilha de
  cotações** (estado + motivo), com "Bloquear agora" quando o banco está
  cifrado.
- `src/presentation/components/ConfirmarBloqueio.tsx` (**novo**) — confirmação
  de bloqueio obrigatória extraída do `BadgeProtegido` e reutilizada no
  Diagnóstico (mesma microcopy, sem duplicação).
- `ARCHITECTURE.md` — camadas/mapa atualizados e seções novas
  **Criptografia e privacidade**, **Modo local** e
  **Planilha de cotações (opcional)**.
- `README.md` — blocos **Criptografia do banco** e **Diagnóstico**.
- Memória do repositório: `~/.copilot/memories/repo/renda.md` (decisões,
  onde mora a criptografia, armadilhas e comandos de validação).
- Testes: `src/application/diagnostics.test.ts` (5).

Validação: 62 arquivos / 655 testes verdes, `tsc --noEmit`, `eslint .` e
`vite build` limpos.

---

## Validação manual pendente (acumulada)

Itens da seção 8 do plano que só podem ser conferidos no navegador, com conta
Google real e HTTPS:

1. Criar banco com checkbox → arquivo cifrado → reload pede a chave.
2. Ativar criptografia → baixar o arquivo do Drive → `gzip -d` falha.
3. Chave errada 3× → mensagens/atraso; nenhum dado alterado.
4. Desativar → arquivo volta a ser gzip legível.
5. Ativar com fila pendente → bloqueado com mensagem.
6. Offline desbloqueado → cache + outbox; reconectar → flush cifrado.
7. Offline bloqueado → app bloqueado, sem flush.
8. Conflito 412 em banco cifrado → resolve e mantém cifrado.
9. Exportar `.ods` de banco cifrado → aviso exibido.
10. Importar `.ods` em banco cifrado → dados gravados, arquivo segue cifrado.
11. Modo local: ativar → reload → bloqueio → senha → abas intactas.
12. Planilha autorizada → preço via `GOOGLEFINANCE`; negada → APIs; 403 → `indisponível`.
13. Migração automática de banco `sheets` → cofre JSON; planilha antiga intacta.
14. `VITE_GOOGLE_BACKEND=sheets` → toggle desabilitado com explicação.
15. "Bloquear agora" → cache some e a chave deixa de ser usada.
16. Reload offline com banco cifrado → desbloqueio pelo verificador local.
17. Criação/ativação sem "Entendi" → botão desabilitado.
18. Cancelar o desbloqueio ao abrir banco pela lista → banco ativo não muda.

---

## Definition of Done (seção 11 do plano)

- [x] Toggle funcional no backend `json` **e** no modo local, refletindo o estado
  real (magic do arquivo / meta do cofre).
- [x] Banco cifrado pede a chave ao abrir e ao restaurar a sessão; a chave
  **nunca** é gravada em `localStorage`/`IndexedDB`/`sessionStorage` (só o
  verificador, para desbloqueio offline).
- [x] Checkbox de criação gera o banco já cifrado (backend `json`).
- [x] Leitura, escrita, `sync` e conflito 412 funcionam com o arquivo cifrado;
  abas locais cifradas funcionam após `localSheets` virar assíncrono (testes
  dedicados).
- [x] "Bloquear agora" limpa o cache de abas, esquece a chave e **pede
  confirmação** (header e Diagnóstico).
- [x] Tela de bloqueio mostra o **nome do banco** e desbloqueia também
  **offline** (verificador local).
- [x] Criação e ativação exigem o checkbox **"Entendi que não há recuperação"**.
- [x] Planilha de cotações: `ativa`, `não autorizada` e `indisponível`, sempre
  com fallback para as APIs (Brapi → Mais Retorno).
- [x] Backend `json` é o padrão; migração automática disponível (e caminho
  manual via `.ods` sem escopo).
- [x] `npm run typecheck`, `npm test -- --run` e `npm run lint` verdes (Node 20)
  — 62 arquivos / 655 testes na última execução, `vite build` ok.
- [x] `ARCHITECTURE.md`/`README.md` atualizados; memória do repositório
  (`~/.copilot/memories/repo/renda.md`) registrando decisão e armadilhas.

### Resumo dos commits

| Fase | Commit |
| --- | --- |
| 2 | `Fase 2: núcleo criptográfico (AES-256-GCM + PBKDF2) do cofre` |
| 3 | `Fase 3: container cifrado e gateway JSON com chave de sessão` |
| 4 | `Fase 4: bloqueio do banco, desbloqueio online/offline e sessão de chaves` |
| 5 | `Fase 5: card de segurança, ativação/desativação e criação de banco cifrado` |
| 6 | `Fase 6: cofre cifrado do modo local e localSheets assíncrono` |
| 7 | `Fase 7: planilha de cotações (GOOGLEFINANCE) como integração opcional` |
| 8 | `Fase 8: backend json como padrão e migração automática de bancos Sheets` |
| 9 | `Fase 9: diagnóstico de criptografia/planilha, docs e memória do repositório` |

### Pendências

1. **Fase 1** (validação do escopo Google/`GOOGLEFINANCE`) continua manual: só
   é possível no navegador, com conta Google real e HTTPS.
2. Os 18 cenários de validação manual da seção 8 (lista acima) não foram
   executados — exigem Google real.
