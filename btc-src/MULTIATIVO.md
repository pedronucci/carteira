# BST — Multiativo e Minhas Carteiras (branch `claude/btc-multiativo`, NÃO publicada)

## O que mudou
- **Posições Perpétuas** (`/perpetuos`): descobre dinamicamente todas as posições da Hyperliquid (BTC, HYPE, SOL, ETH…), cartões por posição, detalhe com gráfico (velas 1 h, 7 dias), entradas/reduções, risco por distância de liquidação, performance por operação, reconciliação por ativo.
- **Dashboard**: painel "Posições perpétuas ativas"; a Estratégia BTC/USDC continua no topo.
- **Risk Center**: exposição por ativo, long × short, queda uniforme até liquidar e simulador de cenários em margem cruzada (BTC −10%, HYPE −15%… individual ou conjunto).
- **Portfólio**: faixa com equity em derivativos, exposição nocional, margem e P&L (conceitos separados; a exposição nunca soma ao patrimônio) e aba **Carteiras** (Minhas Carteiras): apelido, categoria, própria, ativa/pausada, remover, sincronizar, distribuição por rede.
- **Duplicidade**: o mesmo endereço não pode ser cadastrado duas vezes e, se já houver duplicata, a consolidação conta uma só vez (rede + endereço + ativo).
- **Migração**: `migrateWallets()` roda uma vez, guarda cópia das contas em `localStorage["bst.backup.pre-wallets.v1"]` e só ACRESCENTA campos (categoria/ativa/própria). Nenhum dado é apagado. Backup/exportação do app (Ajustes → Backup) continuam valendo.
- Também: moedas spot sem cotação (HYPE) agora entram no patrimônio pelo preço da Hyperliquid.

## Arquivos novos
`src/lib/perps/{positions,trades,scenario,reconcile,view}.ts` (+ testes), `src/lib/wallets.ts` (+ teste), `src/app/perps/page.tsx`, `src/app/risk/perp-risk.tsx`, `src/app/portfolio/wallets.tsx`.
Alterados: `entry.tsx`, `components/nav.tsx`, `app/dashboard/page.tsx`, `app/risk/page.tsx`, `app/portfolio/page.tsx`, `app/providers.tsx`, `lib/api.ts`, `lib/local/hl.ts` (velas por ativo, preços allMids), `lib/connectors/index.ts`, `lib/portfolio/engine.ts`, `lib/demo-seed.ts`.

## Isolamento da Estratégia BTC/USDC
Nenhum módulo de `lib/perps` importa o motor da estratégia (`lib/local/engine.ts`): ciclos, P&L, reconciliação e BTC Buy & Hold seguem intactos. O BTC aparece em Perpétuos com o selo "Vinculada à Estratégia BTC/USDC" por visualização; no patrimônio ele entra uma vez só (a posição é sinalizada por id `conta|perp|ativo`; o patrimônio vem do equity, nunca do nocional).

## Metodologia
- Operação = posição que sai de 0 e volta a 0 (aumentos e reduções parciais fazem parte da mesma). Inversão de sinal divide o fill proporcionalmente. Taxa de acerto e profit factor só contam operações FECHADAS, pelo resultado líquido (realizado − taxas + funding). Posições herdadas (histórico começa no meio) não têm preço médio e são sinalizadas.
- ROI = P&L não realizado ÷ margem usada. Campos sem dado mostram "Não disponível".
- Cenários: conta em margem cruzada; liquidação quando equity ≤ margem de manutenção total (taxa configurável em Ajustes). É estimativa.
- Reconciliação: "Conciliado" exige histórico completo, tamanhos batendo com as execuções, sem posição aberta no início da janela, sem spot volátil fora do modelo e equity dentro da tolerância; caso contrário: parcial, incompleto, divergência ou desatualizado.

## Testes
`pnpm typecheck` e `npx vitest run` (posições, operações, cenários, reconciliação, carteiras + os 72 testes anteriores da Estratégia).

## Limitações
- WebSocket não implementado: atualização por consulta a cada 20 s (já existente) e botão Atualizar/Reconciliar agora.
- Sub-contas, vaults e várias contas Hyperliquid: arquitetura preparada (`accountId` em cada posição), mas só um endereço Hyperliquid configurável hoje.
- OKX: integração existente preservada, sem alterações. Tokens EVM fora do registro verificado e histórico de transações exigem o gateway.
- Resultado da Estratégia com margem compartilhada: continua parcial; o app sinaliza o que não consegue atribuir.
- "Status da investigação" das divergências é informativo (aberta/informativa), ainda sem anotações do usuário.
- Teste de responsividade do iPhone feito por capturas (390 px), não por teste automatizado.

## Implantação (só com sua autorização)
1. Revisar a branch `claude/btc-multiativo`. 2. `cd btc-src/apps/local && node build.mjs`. 3. Copiar `dist/*` para `btc/` (manter `LEIAME.txt`). 4. Commit em `main` (GitHub Pages publica `btc/`).

## Rollback
`git checkout backup/btc-pre-multiativo -- btc btc-src` (estado anterior, já com a correção de patrimônio) ou reverter o commit. No navegador: os dados antigos continuam em `bst.local.v2`/IndexedDB; a cópia das contas antes da migração fica em `bst.backup.pre-wallets.v1`.
