# Minhas Ações — Carteira

Acompanhe sua carteira de investimentos direto do navegador, usando **sua planilha do Google Sheets** como base de dados.

> **Seus dados ficam com você.** O app não tem servidor próprio e não guarda nada: ele é apenas uma "tela" sobre a sua planilha. Tudo o que você lança é salvo na sua conta Google (Sheets/Drive) e permanece sob seu controle.

## Funcionalidades

- Lançamento de operações (compra/venda) e proventos
- Cálculo automático do consolidado da carteira (preço médio, lucro, % da carteira)
- Dashboard com alocação por ativo/categoria e evolução patrimonial
- Rebalanceamento por metas e aporte inteligente
- Importação de extratos da B3 (Área do Investidor)
- Eventos corporativos (split, grupamento, bonificação)

## Tecnologias

- React 18 + TypeScript + Vite
- Tailwind CSS, React Hook Form + Zod, Recharts
- Google Sheets API v4, Google Identity Services, Google Picker
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

## Privacidade

- **100% client-side:** a autenticação e as chamadas ao Google acontecem no seu navegador.
- **Sem backend e sem banco de dados próprio:** a fonte de verdade é a sua planilha.
- Os tokens OAuth ficam apenas no `localStorage` do seu navegador.
