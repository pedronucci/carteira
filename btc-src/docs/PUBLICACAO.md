# Publicação controlada do Terminal 5.0 e reversão

## Onde está cada versão
| O quê | Onde |
|---|---|
| Versão 4 (atual em produção até a aprovação) | commit `7339ebf` na `main` |
| Terminal 5.0 (código, testes, docs e `btc/` compilado) | branch `claude/friendly-hopper-ocnkxv` |
| Gateway (OKX) | `btc-src/apps/gateway`, publicado pela Cloudflare (docs/GATEWAY.md) |

## Antes de publicar (checklist)
1. CI verde na branch (GitHub → Actions → "BTC Terminal — testes").
2. No iPhone, na versão atual: Ajustes → Backup → **Copiar** e guardar o texto numa nota.
3. Aprovar a publicação (merge da branch na `main`). O GitHub Pages publica `btc/` em ~1 minuto.

## Depois de publicar (conferência em 5 minutos)
1. Feche e reabra o app (o service worker troca a versão na reabertura).
2. Estratégia → Monitor: patrimônio, resultado, preço médio e liquidação iguais aos de antes.
3. Estratégia → Ciclos: o ciclo de 05/11/2026 21:13 aparece "em andamento".
4. Ajustes → Backup → Cópias automáticas: a lista existe (a primeira cópia nasce na próxima alteração).
5. Portfólio: a conta da Estratégia aparece; adicione carteiras em Configurações → Integrações quando quiser.

## Dados: o que muda no aparelho
- Os dados da Estratégia (`bst.local.v2`) **não mudam de formato** e não são migrados.
- O Portfólio, o diário e os retratos ficam num banco novo e separado (IndexedDB `bst5`).
- Os alertas ficam em `bst.alerts.v1`; o histórico bruto da Hyperliquid é buscado de novo (formato novo, com
  deduplicação pelo id do negócio) — a própria Hyperliquid devolve os dados.
- O backup passa a ser v4 (Estratégia + Portfólio); backups v1 a v3 continuam aceitos.

## Reversão (se algo der errado)
1. Restaurar o app anterior: na `main`, voltar a pasta `btc/` ao commit `7339ebf`
   (`git checkout 7339ebf -- btc && git commit -m "Reverter para a versão 4" && git push`).
2. Os dados da Estratégia continuam compatíveis com a versão 4 (o formato não mudou).
3. O banco `bst5` (Portfólio) é simplesmente ignorado pela versão 4 e reaparece se o 5.0 voltar.
4. Se uma alteração feita no 5.0 precisar ser desfeita: Ajustes → Backup → Cópias automáticas → Restaurar.

## Limitações conhecidas (honestas)
- A leitura real da OKX só é verificada depois do deploy do gateway e da sua chave somente leitura.
- Hyperliquid: os campos de `rewardsClaim` e a taxa de saque não estão na documentação oficial; conferir com uma
  resposta real da sua conta.
- EVM: sem chave de explorador, só tokens do registro verificado (sem descoberta automática nem histórico).
- Solana: tokens SPL só pelo gateway com um RPC indexado.
- Portfólio: a evolução começa no primeiro retrato (o app grava um por hora quando aberto; o gateway, a cada hora).
- Alertas com o app fechado: proposta em docs/ALERTAS.md, não implementada.
- Mercado: fluxos de ETFs, liquidações agregadas e calendário macro não têm fonte gratuita confiável integrada.
