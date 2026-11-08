# Gateway seguro (Cloudflare Workers) — OKX e tokens Solana

## Por que existe
A OKX só responde a consultas **assinadas** com a sua Secret Key. Uma página pública (GitHub Pages) não pode
guardar segredos, e o navegador não deve guardá-los. O gateway resolve isso:

- é um **Cloudflare Worker** que serve **o mesmo app** e uma **API privada** (`/api/*`) no mesmo endereço;
- o endereço inteiro fica atrás do **Cloudflare Access** (login com código no seu e-mail); o Worker ainda confere,
  em cada chamada da API, a assinatura do token do Access, a audiência, a validade e se o e-mail é o seu;
- as credenciais da OKX chegam uma vez por HTTPS, são **validadas como somente leitura**, **cifradas**
  (AES-GCM 256 com a `MASTER_KEY`) e guardadas no KV. Nunca voltam ao navegador, ao GitHub ou a logs;
- só endpoints **GET** da OKX são usados: nenhuma ordem, nenhum saque, nenhuma transferência;
- chamadas de outras origens são recusadas (sem CORS); há limite de frequência por rota;
- um agendamento (a cada hora) guarda um retrato da OKX, mesmo com o app fechado.

Por que o app também é servido pelo gateway: o Safari do iPhone bloqueia cookies de terceiros. Se o app ficasse
só no GitHub Pages, ele precisaria guardar um token no aparelho para falar com o gateway. No mesmo endereço, o
login do Access protege tudo sem nenhum segredo no navegador. O GitHub Pages continua funcionando como antes
(sem a OKX).

## Custos
Plano gratuito da Cloudflare: Workers (100 mil requisições/dia), KV (gravações e leituras gratuitas dentro dos
limites diários), Cron Triggers e Access (até 50 usuários). Uso pessoal fica dentro do gratuito.

## Passo a passo (uma vez)

1. **KV** — Painel da Cloudflare → Storage & Databases → KV → *Create namespace* → nome `BST`.
   Copie o **ID** e cole em `apps/gateway/wrangler.toml` (`id = "…"`). O ID não é segredo.
2. **Worker pelo GitHub** (Workers Builds) — Workers & Pages → *Create* → *Import a repository* →
   `pedronucci/carteira`, branch `main` (ou a de desenvolvimento para testar):
   - Root directory: `btc-src`
   - Build command: `npx pnpm@10.28.0 install --frozen-lockfile && npx pnpm@10.28.0 --filter @bst/local build`
   - Deploy command: `npx wrangler deploy --config apps/gateway/wrangler.toml`
3. **Segredo** — no Worker `carteira` → Settings → Variables and Secrets → *Add* → tipo **Secret**:
   - `MASTER_KEY` = 32 bytes aleatórios em base64. Gere no Terminal: `openssl rand -base64 32`.
     Guarde uma cópia num gerenciador de senhas: sem ela, as credenciais guardadas não podem ser lidas
     (basta conectar a OKX de novo).
   - (opcional) `SOLANA_RPC_URL` = URL de um RPC Solana indexado (ex.: Helius, plano gratuito), para tokens SPL.
4. **Cloudflare Access** (o "porteiro" que exige login antes de abrir o gateway):
   1. *Ativar o Zero Trust (uma vez)*: no painel, menu **Zero Trust**. Na primeira vez ele pede um **team name**
      (ex.: `pedronucci`) e um plano: escolha **Free** (pode pedir um cartão para validar a conta; o Free não cobra).
      O seu *team domain* passa a ser `pedronucci.cloudflareaccess.com`.
   2. *Ligar o login por código no e-mail*: Zero Trust → **Settings** → **Authentication** → **Login methods** →
      **Add new** → **One-time PIN** → **Save** (nas contas novas ele não vem ligado).
   3. *Proteger o Worker*: **Workers & Pages** → `carteira` → **Settings** → **Domains & Routes** → na linha
      `workers.dev`, ative **Cloudflare Access** (em alguns layouts fica no menu ⋯ da linha). Isso cria um aplicativo
      do Access para o endereço `carteira.<sua-conta>.workers.dev`.
   4. *Só o seu e-mail entra*: Zero Trust → **Access** → **Applications** → abra o aplicativo criado → **Policies** →
      edite a política (ou **Add a policy**): **Action: Allow**; em **Include**, seletor **Emails** → o seu e-mail.
      Apague qualquer regra que inclua "Everyone" ou um domínio inteiro. Em **Login methods** do aplicativo, deixe
      marcado **One-time PIN**.
   5. *Copiar dois valores*: no mesmo aplicativo (aba **Overview**/**Basic information**), copie a
      **Application Audience (AUD) Tag** (64 caracteres hexadecimais). O *team domain* fica em Zero Trust →
      **Settings** → **Team name and domain** (ou **Custom Pages**, em layouts antigos).
5. **Variáveis** — no Worker → Settings → Variables and Secrets → **+ Add**, tipo **Text** (não são segredos, mas
   ficam só no painel; o `wrangler.toml` tem `keep_vars = true` para o deploy não apagá-las):
   `ACCESS_TEAM_DOMAIN` = `pedronucci.cloudflareaccess.com` (sem `https://`), `ACCESS_AUD` = a tag copiada,
   `OWNER_EMAIL` = o mesmo e-mail da política. Clique em **Deploy**.
6. **Deploy** — faça um commit/push (o Workers Builds publica). Abra `https://carteira.<sua-conta>.workers.dev`:
   o Access pede o código do e-mail e depois mostra o terminal.
7. **Seus dados** — o app no gateway tem um armazenamento próprio (outro endereço). No app do GitHub Pages:
   Ajustes → Backup → Copiar. No gateway: Ajustes → Backup → colar e restaurar. No iPhone, adicione o endereço
   do gateway à Tela de Início.
8. **OKX** — no site da OKX: Perfil → API → *Create API key* → permissão **somente Read** (sem Trade, sem
   Withdraw), sem vincular IP (chaves só de leitura sem IP não expiram; as com Trade/Withdraw sem IP expiram em
   14 dias sem uso — documentação OKX). Defina uma Passphrase. No terminal pelo gateway:
   Configurações → OKX → cole API Key, Secret Key e Passphrase → *Testar e conectar*.
   O gateway consulta `GET /api/v5/account/config` e **recusa** a chave se `perm` não for só `read_only`.

## Revogar
Configurações → OKX → *Desconectar e revogar* apaga as credenciais do KV. Depois apague a API Key no site da OKX.
Para bloquear tudo de uma vez: desative a aplicação do Access ou o Worker.

## O que é lido da OKX (API v5, documentação consultada em 07/11/2026)
| Endpoint | Uso |
|---|---|
| `GET /api/v5/account/config` | permissões da chave (`perm`) — só aceita `read_only` |
| `GET /api/v5/account/balance` | conta de trading: `totalEq`; por moeda `eq` (com P&L aberto), `eqUsd`, `availBal`, `frozenBal` |
| `GET /api/v5/asset/balances` | conta de funding: `bal`, `availBal`, `frozenBal` |
| `GET /api/v5/finance/savings/balance` | Simple Earn: `amt` |
| `GET /api/v5/account/positions` | derivativos: `pos` (contratos), `avgPx`, `markPx`, `notionalUsd`, `upl`, `lever`, `liqPx`, `margin`/`imr` |
| `GET /api/v5/public/instruments` | `ctVal`/`ctMult` para converter contratos em BTC |
| `GET /api/v5/asset/deposit-history` / `withdrawal-history` | depósitos (`state` 2) e saques (`state` 2) concluídos, com `txId` para parear com as carteiras |

Contabilidade: a conta de trading entra pelo **patrimônio de cada moeda** (`eq`/`eqUsd`, que já inclui o P&L
aberto); as posições aparecem à parte e **nunca são somadas**; funding e Earn são contas separadas.

## Verificado neste ambiente
- Testes automatizados (21): Access (token válido e 7 formas de token inválido), cifra (ida e volta, adulteração,
  contexto e chave errados), assinatura igual ao HMAC da documentação, recusa de chave com Trade, recusa de frase
  de recuperação, segredo nunca devolvido, limite de frequência, revogação, cron e normalização.
- `wrangler dev` (runtime da Cloudflare): app servido, `/api` sem login → 401, outra origem → 403.
- OKX real: `public/instruments` no formato usado; chamada assinada com chave falsa → código `50119` documentado.
- Não verificado: a leitura com a **sua** chave real (só depois do deploy e da sua chave).
