# Minhas Ações — Carteira

Acompanhe sua carteira de investimentos direto do navegador, usando **sua conta Google como base de dados**: uma planilha do Google Sheets ou um único **arquivo JSON compactado (gzip) no Google Drive**. O app é um **PWA instalável** que funciona **offline** e sincroniza com a nuvem quando a conexão volta.

> **Seus dados ficam com você.** O app não tem servidor próprio: ele é uma "tela" sobre o seu banco na nuvem. Tudo o que você lança é salvo na sua conta Google (Sheets/Drive); uma cópia local (cache + fila de alterações) fica apenas no seu navegador para o funcionamento offline.

## Funcionalidades

- Lançamento de operações (compra/venda) e proventos
- Cálculo automático do consolidado da carteira (preço médio, lucro, % da carteira)
- Dashboard com alocação por ativo/categoria e evolução patrimonial
- Rebalanceamento por metas e aporte inteligente
- Importação de extratos da B3 (Área do Investidor)
- Eventos corporativos (split, grupamento, bonificação)
- **PWA instalável** com funcionamento offline (leitura do último estado em cache)
- **Sincronização automática**: alterações feitas offline são reaplicadas na planilha ao reconectar

## Tecnologias

- React 18 + TypeScript + Vite
- Tailwind CSS, React Hook Form + Zod, Recharts
- Google Sheets API v4, Google Drive API (arquivo JSON gzip), Google Identity Services, Google Picker
- `vite-plugin-pwa` (manifest + service worker instalável)
- IndexedDB (cache local de abas e fila de sincronização offline)
- Vitest para testes unitários

## Pré-requisitos

- Node.js 18+ e npm
- Uma conta Google e um projeto no [Google Cloud Console](https://console.cloud.google.com/) com as APIs **Google Sheets** e **Google Drive** habilitadas (a seleção de planilha existente exige também a **Google Picker API**). Ao usar o backend `json` (`VITE_GOOGLE_BACKEND=json`) basta a **Google Drive API**

## Rodando localmente

1. Clone o repositório e instale as dependências:
   ```bash
   git clone <url-do-repositorio>
   cd minhaacoes
   npm install
   ```

2. Configure as variáveis de ambiente:
   ```bash
   cp .env.example .env
   ```
   Preencha o `.env` (as instruções de cada variável estão no próprio `.env.example`):

   - `VITE_GOOGLE_CLIENT_ID` — **obrigatório** (OAuth 2.0)
   - `VITE_GOOGLE_BACKEND` — opcional (`sheets`, padrão, ou `json`; ver seção abaixo)
   - `VITE_GOOGLE_PICKER_API_KEY` — opcional (selecionar uma planilha existente; backend `sheets`)
   - `VITE_GOOGLE_PROJECT_NUMBER` — opcional (usado como `appId` do Picker)
   - `VITE_GA_MEASUREMENT_ID` — opcional (Measurement ID do GA4; habilita telemetria do Google Analytics)

3. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
   Abra `http://localhost:5173`.

4. No Google Cloud Console, adicione `http://localhost:5173` em **Origens JavaScript autorizadas** da credencial OAuth (ID do cliente → tipo "Aplicativo da Web").

## Backend do modo Google: planilha ↔ arquivo JSON

O modo com login Google tem **dois backends**, escolhidos em tempo de **build** por `VITE_GOOGLE_BACKEND`:

| Backend | Escopos OAuth | Onde os dados ficam | Criar | Abrir existente | Link |
| --- | --- | --- | --- | --- | --- |
| `sheets` (padrão) | `spreadsheets` + `drive.file` | planilha do Google Sheets | planilha nova (7 abas) | lista as planilhas visíveis (Picker opcional) | `docs.google.com/spreadsheets/d/…` |
| `json` | **`drive.file`** | um arquivo `*.json.gz` no Drive (pasta `minhasacoe_app`) | arquivo novo com as 7 abas vazias | lista os bancos criados pelo app | `drive.google.com/file/d/…` |

- O backend `json` usa apenas o escopo **`drive.file`**, que **não é sensível**: dispensa a verificação OAuth do Google (e o vídeo de demonstração) para publicar o app.
- Em **Abrir banco existente** aparece a lista dos bancos já existentes (nome + última modificação); basta escolher um para carregar. No backend `sheets`, o Google Picker continua disponível como ação secundária para abrir uma planilha que o app ainda não conhece.
- O arquivo é um JSON `{ version, sheets }` com uma matriz de células por aba, compactado com gzip (`CompressionStream` nativo) — o mesmo modelo do modo local e do `.ods`.
- Cada escrita faz *read-modify-write* com **etag + `If-Match`**; um conflito (HTTP 412) relê o arquivo e reaplica a alteração.
- No flush da fila offline, todas as mutações pendentes são aplicadas numa única leitura + uma única escrita.
- Para publicar com o novo backend: `VITE_GOOGLE_BACKEND=json npm run build` (o valor é lido em tempo de build; reinicie o `npm run dev` após alterar o `.env`).

O modo **local** (botão "Usar sem Google", IndexedDB + exportação/importação `.ods`) é independente do backend e continua funcionando igual.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento (Vite) |
| `npm run build` | typecheck + build de produção |
| `npm run preview` | serve o build de produção localmente |
| `npm test` | roda os testes (Vitest) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

## Arquitetura

O projeto aplica **SOLID** e **DDD** em camadas (Clean Architecture / Ports & Adapters). Veja o mapa completo em [ARCHITECTURE.md](./ARCHITECTURE.md).

## PWA e modo offline

O app é um **PWA instalável** (manifest + service worker via `vite-plugin-pwa`) e funciona **offline**:

- **Leitura offline:** o dashboard e as demais telas leem o **último estado em cache** (IndexedDB) quando não há conexão.
- **Escrita offline:** operações e proventos lançados sem rede ficam numa fila local (outbox) e são reaplicados no banco da nuvem automaticamente ao reconectar.
- **Sincronização:** ocorre ao abrir o app, a cada reconexão e por retry periódico; um indicador no cabeçalho mostra o estado (offline / pendências / sincronizado) e permite forçar a sincronização.
- **Atualizar cotações:** o botão **Atualizar** do dashboard relê os dados e busca os preços atuais de Ação/FII/BDR/ETF nas APIs de cotação configuradas — **Brapi** e, se ela não devolver o preço (ou não estiver configurada), **Mais Retorno** — ignorando o cache local, e os grava na carteira. Os tokens são informados dentro do app, em **Configurações → Integrações** (não vão no `.env`) e ficam salvos na própria planilha/banco JSON. Se a integração não estiver configurada (token ausente) ou não devolver preço, o dashboard exibe um aviso com o motivo.
- O service worker é habilitado apenas no **build de produção** (`npm run build` + `npm run preview`); em desenvolvimento (`npm run dev`) ele fica desligado.

## Privacidade

- **100% client-side:** a autenticação e as chamadas ao Google acontecem no seu navegador.
- **Sem backend e sem banco de dados próprio:** a fonte de verdade é a sua planilha (ou o arquivo JSON no Drive); localmente o app guarda apenas um espelho em cache e a fila de alterações offline.
- Os tokens OAuth ficam apenas no `localStorage`; o cache de abas e a fila offline ficam no **IndexedDB** do navegador.
