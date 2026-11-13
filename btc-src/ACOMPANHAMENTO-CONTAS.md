# Acompanhamento de contas — remoção da estratégia BTC/USDC

Data: 13/11/2026. Branch: `fix/acompanhamento-sem-estrategia`. Base: `d02ab40`, incluindo a reconciliação HL anterior. Alterações locais; publicação não realizada.

## Comportamento

- Removidos cartão, menu, rotas ativas, ciclos nas configurações e painéis da estratégia em performance/risco. Links antigos da estratégia mostram posições. A navegação móvel dá acesso a Performance.
- A conta Hyperliquid principal continua conectada pelo mesmo endereço e identificador interno, preservando notas e vínculos. Posições BTC deixam de ser vinculadas automaticamente à estratégia.
- O patrimônio consolidado usa saldos oficiais das contas; capital e operações manuais da antiga estratégia não alimentam o portfólio.
- Depósitos/retiradas das contas HL principal e adicionais entram como fluxos, deduplicados por conta e chave. Recompensas, trading, taxas e funding não são classificados como aportes.
- Transferências próprias geram fluxos por conta. No agregado com as duas contas, as pontas se compensam; nos filtros de origem/conta, neutralizam o deslocamento do patrimônio.
- A variação de saldo por ativo não é apresentada como rentabilidade. Variação de preço em 24h continua separada.
- Retorno entre retratos é Modified Dietz encadeado, aproximado quando não há avaliação no instante exato de cada fluxo. Resultado monetário é patrimônio final − inicial − fluxos líquidos.

## Preservação e séries

Backup do código anterior: `backups/antes-remover-estrategia-2026-11-13.zip`, na raiz do workspace. Histórico e cadastros antigos permanecem nas estruturas salvas/exportadas, mas o módulo foi retirado do produto ativo. Na primeira leitura, cópia adicional do localStorage em `bst.local.v2.before-accounts-v1` e do portfólio no IndexedDB (`bst5/kv`, chave `portfolio.before-accounts-v1`).

Retratos novos usam origem `accounts-v1`. Retratos legados permanecem armazenados/exportados, sem entrar na nova série: não é possível provar se todos refletiam conta oficial ou modelo manual. A nova série exige dois retratos válidos para exibir retorno. Isso evita reaproveitar um histórico cuja base mudou silenciosamente.

## Verificação executada

- 380 testes passaram nos quatro pacotes: domínio 83, local 247, gateway 29, proxy 21. Os 11 novos casos cobrem depósitos, retiradas, transferências entre contas e recortes por conta, sync repetido, taxas, funding/recompensa, duas contas HL, cobertura incompleta OKX, preço histórico ausente e preservação de retratos.
- Typecheck dos quatro pacotes passou; build local gerado. Após o último ajuste de vinculação BTC, repetidos os 15 testes específicos de posições e fluxos, com sucesso.
- Navegação no navegador: Dashboard, Posições, Performance, Configurações, Portfólio e Risk Center; atalho antigo `/estrategia`; menu móvel. Sem erros de console na navegação observada. Sem importar dados pessoais para localhost.
- Consultados os contratos oficiais de eventos [Hyperliquid](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions) e de [OKX API v5](https://www.okx.com/docs-v5/en/). Nenhuma ordem ou transferência executada.

## Limites relevantes

Testes sintéticos verificam invariantes e regressões; não certificam todos os saldos pessoais. Não houve nova comparação com extratos oficiais pessoais, autenticação OKX ou leitura de dados do navegador de produção. O gateway já marca o histórico OKX como incompleto enquanto cobertura de transferências/bills não estiver conciliada. Nesses casos, retorno consolidado fica indisponível, preservando saldos oficiais, sem transformar entradas desconhecidas em lucro.

É necessário reconciliar extratos oficiais para certificar resultado pessoal, custos históricos de ativos e janelas não cobertas pelas APIs. As regressões da correção de reconciliação anterior continuam passando. Sem refatorar engines legadas arquivadas nem apagar registros pessoais.
