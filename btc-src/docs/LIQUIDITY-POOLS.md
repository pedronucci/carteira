# LIQUIDITY POOLS — entrega e metodologia

Branch de implementação: `codex/liquidity-pools`. Módulo exclusivamente de leitura. Nenhuma assinatura ou ordem.

## Operacional

- Carteiras existentes EVM/Solana, múltiplos endereços, descoberta paginada automática e sincronização manual/periódica com exclusão mútua.
- Uniswap V3 por enumeração do Position Manager nas seis redes. V2 e V4 por inventário Blockscout, confirmado por chamadas on-chain. V2 verifica factory e getPair; V4 verifica proprietário e PoolKey.
- Orca Whirlpools, incluindo Position Bundles, Raydium CLMM e Raydium CPMM. SPL clássico e Token-2022; propriedade confirmada no mesmo snapshot da posição. CPMM desconta reservas pertencentes ao protocolo, fundo e criador.
- Fees V3/V4 Q128 e Orca/Raydium Q64, com aritmética inteira e wrap sem sinal. Valores a receber não são automaticamente tratados como taxas: podem conter principal.
- Histórico de aumentos, reduções, coletas e retiradas. Eventos EVM conferidos com recibos; slots Solana finalizados e ordem das transações no bloco quando necessário. A liquidez final deve reconciliar com a posição.
- P&L líquido, realizado/não realizado pelo custo médio, fees realizadas, gas e Modified Dietz quando há cobertura. Gas compartilhado rateado igualmente entre posições acompanhadas na mesma transação.
- APR histórico de fees, APR anualizado do resultado e APY hipotético com reinvestimento diário identificados separadamente. Não são promessas de rendimento.
- Exposição por rede/protocolo e por identidade de token, range, histórico observado de valor/resultado/fees/APR, comparação com HODL e simulador concentrado versus 50/50.
- HODL e divergência (IL sem fees) para aportes sem resgates ou aquisição por transferência. Usa as quantidades efetivas depositadas, sem presumir 50/50 em CL. Cenários mais complexos permanecem indisponíveis.
- Pool Explorer com dados reais DexScreener/DefiLlama, filtros, paginação e ranking por TVL. Alertas locais de saída do range e quedas entre consultas da mesma fonte: TVL 30%, volume/APY 50%, intervalo mínimo de seis horas por alerta de mercado.
- LPs no patrimônio da carteira, substituindo apenas recibos exatos da mesma conta. Tokens livres não são subtraídos. Composição indireta não é somada novamente. Resultados LP disponíveis em Performance Attribution, separados do recorte de operações spot/perpétuas.
- Cache em IndexedDB `bst-liquidity-v1`, compatível com os bancos anteriores. Backup v4 inclui LPs opcionalmente; backups antigos preservam o cache LP. Restauração validada antes de alterar dados, com diário de recuperação.

## Proteção da rentabilidade

`PnL = valor atual + distribuições − aportes − gas`.

Redução de liquidez V3 transfere custo para principal a receber; apenas a coleta efetiva é distribuição. Não conta a redução e a coleta duas vezes. V2/CPMM reinvestem fees nas reservas: retiradas não são apresentadas integralmente como taxas.

A série que inclui LPs usa `accounts-lp-v2`; retratos `accounts-v1` são preservados. A descoberta de LPs preexistentes não cria lucro histórico. O histórico completo de **todos** os fluxos externos de carteiras EVM/Solana ainda não é fornecido pelos conectores de saldos. Portanto, a rentabilidade global dessas carteiras fica indisponível, em vez de atribuir entradas de dinheiro a ganhos. P&L individual LP pode estar disponível independentemente disso.

## Fontes e acesso

- RPCs públicos das redes, Blockscout público, API oficial Raydium, DefiLlama Coins/Yields e DexScreener.
- No gateway privado existente: `/api/liquidity/data`, depois da mesma autenticação Cloudflare Access. Lista fechada de hosts, caminhos e métodos de leitura, sem redirecionamentos, com limites de corpo/resposta e controle de frequência. O RPC Solana já configurado no servidor é reutilizado quando disponível; sua URL nunca retorna ao cliente.
- No GitHub Pages: consultas diretas às mesmas fontes públicas, sujeitas a CORS e limites do provedor. Nenhuma chave é embutida.
- V3 revalida os últimos 128 blocos; V2/V4 reutilizam recibos previamente conferidos fora dessa janela. Solana reutiliza eventos finalizados. Falhas não confirmam saldo zero e preservam registros anteriores.

Referências de implementação: [Uniswap PositionInfo](https://github.com/Uniswap/v4-periphery/blob/main/src/libraries/PositionInfoLibrary.sol), [Orca state](https://github.com/orca-so/whirlpools/tree/main/programs/whirlpool/src/state), [Raydium CLMM](https://github.com/raydium-io/raydium-clmm), [Raydium CPMM](https://github.com/raydium-io/raydium-cp-swap), [OP Stack gas](https://specs.optimism.io/protocol/jovian/exec-engine.html).

## Limitações explícitas

- O endpoint público BNB Blockscout retornou 404 na verificação. V2/V4 e histórico nessa rede dependem de inventário/indexador disponível; V3 direto e Explorer continuam independentes. Algumas outras fontes podem impor 403/429, atraso ou indisponibilidade. Não há garantia de descoberta universal.
- Transações com swaps e várias posições sem atribuição verificável, aquisição de NFTs/cotas sem custo conhecido, histórico truncado e preços ausentes bloqueiam métricas financeiras. Não preenche lacunas com zero.
- Fees adicionais de operador OP/Base com scalar não zero exigem identificação do fork ou valor explícito no recibo; se ausente, gas e resultado líquido ficam indisponíveis. Inclui L1 quando fornecida. Polygon usa cotação MATIC/POL para gas, não ETH.
- Incentivos/recompensas adicionais não são incluídos no valor conhecido. Valoração concentrada usa matemática decimal de alta precisão; não é cotação de resgate executável nem reprodução bit a bit de TickMath. Interface identifica valores estimados.
- Volatilidade, volume 7d, idade e fee tier dependem da fonte. Histórico gráfico nasce das observações locais, sem reconstrução fictícia de candles. Alertas exigem app aberto/consultas; não há notificações com o app fechado.

## Verificação e reversão

Comandos: `pnpm -r typecheck`, `pnpm -r test`, `pnpm build`.

Casos cobertos: aportes sem lucro, retiradas parciais/totais, principal pendente, coletas, gas por TX, liquidez divergente, preços ausentes, estado antigo, Q64/Q128, arrays estáticos/dinâmicos, reservas CPMM, recibos duplicados, persistência e backup, substituição de recibos no patrimônio, autenticação/origem do gateway e bloqueio de SSRF/envio de transações.

Leitura real conferida: pool Raydium CLMM `5mfjy2Ns9MWuVB6z3N1oFGJKSd6RyG2PAdyH2wDKDaMY`, slot finalizado `469914294`, proprietário do programa, mints e sqrtPrice consistentes com API oficial. Explorer real, simulação e edição livre de números conferidos no navegador. Viewport 390×844 sem transbordamento horizontal da página.

Backup da versão anteriormente publicada: `backups/antes-conclusao-liquidity-pools-2026-11-15/versao-publicada.zip`, na raiz do workspace. Base: `d79d3ea9d56f288e7cb3086fb53ad78e00e7332d`. SHA256 `EB200003BAD38E75DEA36D20D20039864E13072B1DBFD0D5EE935C445281C4CF`.

Reversão de publicação: restaurar `btc/` e o código do gateway desse commit, recompilar e republicar com as variáveis existentes preservadas. Não apagar IndexedDB nem credenciais. A versão anterior ignora o cache LP novo.
