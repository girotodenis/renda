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
| 2 | Núcleo criptográfico | ✅ concluída | ver commit "Fase 2" |
| 3 | Container e gateway JSON | ✅ concluída | ver commit "Fase 3" |
| 4 | Abertura, bloqueio e sessão | ✅ concluída | ver commit "Fase 4" |
| 5 | Configurações e criação | ⏳ a fazer | — |
| 6 | Modo local cifrado | ⏳ a fazer | — |
| 7 | Planilha de cotações | ⏳ a fazer | — |
| 8 | Backend `json` padrão + migração | ⏳ a fazer | — |
| 9 | Diagnóstico, docs e memória | ⏳ a fazer | — |

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

**Resultado:**

---

## Fase 6 — Modo local cifrado

- [ ] `cripto/localCofre.ts`
- [ ] `localSheets` assíncrono
- [ ] `localGateway` com `await` + `ChaveNecessariaError`
- [ ] bloqueio/desbloqueio do workspace `local`

**Aceite:** abas cifradas no IndexedDB (sem texto legível), exporta `.ods` com
aviso, suíte local verde.

**Resultado:**

---

## Fase 7 — Planilha de cotações

- [ ] `cotacoes/planilhaGoogle/api.ts`, `planilha.ts`, `index.ts`
- [ ] `accessToken` nas opções de consulta
- [ ] registro na cadeia antes de Brapi
- [ ] card de status/autorização em Configurações
- [ ] testes dos três estados e do fallback

**Aceite:** autorizada → preço da planilha; negada/403 → APIs; dashboard igual
nos dois casos.

**Resultado:**

---

## Fase 8 — Backend `json` padrão + migração

- [ ] `GOOGLE_BACKEND` padrão `json`; `.env.example`/README
- [ ] `application/migrarPlanilha.ts` + tela de oferta + idempotência
- [ ] migração manual via `.ods` quando o escopo for negado

**Aceite:** build padrão usa o cofre; banco antigo migra sem perda; planilha
antiga permanece intacta.

**Resultado:**

---

## Fase 9 — Diagnóstico, docs e memória

- [ ] diagnóstico (criptografia + planilha)
- [ ] `ARCHITECTURE.md`, `README.md`
- [ ] memória do repositório

**Resultado:**

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
