# Minhas Ações — Carteira

Acompanhe sua carteira de investimentos direto do navegador, usando **sua planilha do Google Sheets** como base de dados. O app é um **PWA instalável** que funciona **offline** e sincroniza com a planilha quando a conexão volta.

> **Seus dados ficam com você.** O app não tem servidor próprio: ele é uma "tela" sobre a sua planilha. Tudo o que você lança é salvo na sua conta Google (Sheets/Drive); uma cópia local (cache + fila de alterações) fica apenas no seu navegador para o funcionamento offline.

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
- Google Sheets API v4, Google Identity Services, Google Picker
- `vite-plugin-pwa` (manifest + service worker instalável)
- IndexedDB (cache local de abas e fila de sincronização offline)
- Vitest para testes unitários

## Pré-requisitos

- Node.js 18+ e npm
- Uma conta Google e um projeto no [Google Cloud Console](https://console.cloud.google.com/) com as APIs **Google Sheets** e **Google Drive** habilitadas (a seleção de planilha existente exige também a **Google Picker API**)

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
   - `VITE_GOOGLE_PICKER_API_KEY` — opcional (selecionar uma planilha existente)
   - `VITE_GOOGLE_PROJECT_NUMBER` — opcional (usado como `appId` do Picker)
   - `VITE_TESOURO_API_URL` — opcional (endpoint alternativo de cotações do Tesouro)
   - `VITE_BRAPI_TOKEN` — opcional (fallback de cotação B3 quando o `GOOGLEFINANCE` falha)

3. Rode o servidor de desenvolvimento:
   ```bash
   npm run dev
   ```
   Abra `http://localhost:5173`.

4. No Google Cloud Console, adicione `http://localhost:5173` em **Origens JavaScript autorizadas** da credencial OAuth (ID do cliente → tipo "Aplicativo da Web").

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
- **Escrita offline:** operações e proventos lançados sem rede ficam numa fila local (outbox) e são reaplicados na planilha automaticamente ao reconectar.
- **Sincronização:** ocorre ao abrir o app, a cada reconexão e por retry periódico; um indicador no cabeçalho mostra o estado (offline / pendências / sincronizado) e permite forçar a sincronização.
- O service worker é habilitado apenas no **build de produção** (`npm run build` + `npm run preview`); em desenvolvimento (`npm run dev`) ele fica desligado.

## Privacidade

- **100% client-side:** a autenticação e as chamadas ao Google acontecem no seu navegador.
- **Sem backend e sem banco de dados próprio:** a fonte de verdade é a sua planilha; localmente o app guarda apenas um espelho em cache e a fila de alterações offline.
- Os tokens OAuth ficam apenas no `localStorage`; o cache de abas e a fila offline ficam no **IndexedDB** do navegador.
