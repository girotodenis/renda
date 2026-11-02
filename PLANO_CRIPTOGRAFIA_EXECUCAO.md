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
| 3 | Container e gateway JSON | ⏳ a fazer | — |
| 4 | Abertura, bloqueio e sessão | ⏳ a fazer | — |
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

**Resultado:**

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

**Resultado:**

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
