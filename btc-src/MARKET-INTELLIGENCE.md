# Market Intelligence (fase 2)

Nova aba **Market Intelligence** (`/mercado-intel`) + widget **Radar de Mercado** na Dashboard + Worker público `apps/market-proxy`. Somente leitura, sem IA, sem recomendação de compra/venda.

## O que faz
- **Notícias em português** (Portal do Bitcoin, Livecoins, Cointelegraph Brasil, InfoMoney) via RSS; título + resumo de até 280 caracteres, link para a fonte.
- **Calendário econômico oficial**: FOMC/Beige Book/ata (lista fixa do federalreserve.gov) e BLS (CPI, emprego, PPI; iCal ao vivo). Consenso de mercado: **indisponível** (sem fonte pública gratuita confiável). BEA e Tesouro ainda não incluídos.
- **Relevância** 0–100 por regras: ativo que você tem (à vista ou perpétuo) + tema + recência. Sem ativo/tema = fora do escopo.
- **Impacto no portfólio** (cartões por regras R1–R5, cada um cita a regra): evento macro em 48 h com perpétuos abertos; volume de notícias em ativo seu; segurança/hack em ativo seu; regulação/ETF em BTC; liquidação próxima em dia agitado.
- **Filtros**: ativo, tema, relevância, busca. Itens lidos ficam esmaecidos.
- **Alertas só no app** (toast + contagem no Radar), desligáveis; cartões podem ser dispensados.
- **Eventos × performance**: variação da carteira (TWR, sem aportes) e do BTC em 1h/4h/24h/7d após cada evento de alta importância, só com retratos reais; senão "—" (Dados insuficientes). Correlação não é causalidade.

## Privacidade
O app só faz `GET /news` e `GET /calendar` no proxy, sem parâmetros, cookies ou credenciais. Nada do portfólio sai do navegador; relevância e cartões são calculados localmente. O Worker não tem KV, segredos nem acesso a contas, e só busca URLs de uma lista fixa (não é proxy aberto).

## Arquivos
- `apps/market-proxy/` (novo): `src/parse.ts` (RSS/Atom/iCal), `src/sources.ts`, `src/index.ts`, `wrangler.toml`, `test/parse.test.ts` (17 testes)
- `apps/local/src/lib/market/radar.ts` (+ `radar.test.ts`, 17 testes), `feed.ts` (cliente/cache/prefs), `use.ts` (hook)
- `apps/local/src/app/mercado-intel/page.tsx`; `app/dashboard/hub.tsx` (`RadarCard`) e `dashboard/page.tsx`
- `components/nav.tsx` (aba), `entry.tsx` (rota), `lib/demo-seed.ts` (só prévia)

## Deploy do Worker (sua conta Cloudflare)
1. `cd btc-src && pnpm install`
2. `cd apps/market-proxy && npx wrangler login` e depois `npx wrangler deploy`
3. Anote o endereço `https://bst-market-proxy.<seu-usuario>.workers.dev`; abra `/health` e `/news` no navegador para conferir (`/news` lista o status de cada fonte).
4. No app, aba Market Intelligence → cole o endereço → Salvar. (Ou me passe o endereço para eu deixar como padrão no build.)
5. Se a origem do app mudar, ajuste `ALLOWED_ORIGINS` em `wrangler.toml`.
Custo: plano gratuito da Cloudflare; nenhuma chave de API necessária.

## Limitações conhecidas
- Os feeds RSS e o iCal do BLS **não puderam ser testados ao vivo** (o ambiente de desenvolvimento não alcança esses sites): parsers cobertos por testes com amostras; o `/news` do Worker informa por fonte se funcionou. Se uma URL de feed mudar, ajuste `src/sources.ts`.
- Lista do FOMC é fixa (atualizar 1x/ano); 2027 só até julho (publicado).
- Classificação por palavras-chave: pode errar em manchetes ambíguas.
- Limite de uso por IP no Worker é em memória (melhor esforço).
- Sem alerta com o app fechado (apenas no app).
- Correlação limitada pela frequência dos retratos (1 por hora, desde a primeira abertura do app).

## Rollback
Branch `claude/btc-market-intelligence`; reverter o commit na main e rebuildar. O Worker pode ser apagado no painel da Cloudflare sem afetar nada. Dados locais novos: `bst.mi.v1` e `bst.mi.cache.v1` (podem ser apagados).
