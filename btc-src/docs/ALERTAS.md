# Alertas

## Hoje (implementado): alertas locais
- Regras em Alertas (sino no cabeçalho): BTC acima ou abaixo de um preço, distância da liquidação, alavancagem
  efetiva, queda desde o pico, mudança de funding, mudança da exposição líquida em BTC, variação do BTC equivalente
  da estratégia, divergência entre o saldo oficial e o cálculo, e falha de sincronização.
- Avaliadas com o app **aberto**, no máximo a cada 30 s, com os dados reais (Estratégia, Portfólio e mercado).
- Disparam na **transição** (a condição passa a ser verdadeira) e respeitam o intervalo mínimo da regra; aparecem no
  app, no histórico e, se você permitir, como notificação do sistema.
- Ficam no aparelho (`bst.alerts.v1`): não são segredo.

## Com o app fechado (proposta, não implementada)
Uma página estática não roda quando está fechada; o iPhone suspende o app. O caminho seguro reaproveita o gateway:

1. **Web Push** (padrão W3C; no iPhone, iOS 16.4 ou mais novo e o app **adicionado à Tela de Início**):
   - gerar um par de chaves VAPID; a chave privada vira segredo do Worker (`VAPID_PRIVATE_KEY`);
   - o app (aberto pelo gateway) pede permissão e envia a inscrição de push ao gateway, que a guarda no KV;
2. **Avaliação no servidor:** o cron do gateway (já roda a cada hora; pode ser a cada 5 a 15 min) lê a Hyperliquid
   (pública, pelo endereço) e a OKX (credenciais cifradas), avalia as mesmas regras (o avaliador é o mesmo código
   do `@bst/domain`) e envia a notificação cifrada (RFC 8291) ao serviço de push do navegador;
3. **Custos:** dentro do plano gratuito dos Workers para uso pessoal. Cron a cada 5 min = 288 execuções/dia.

Limites honestos: o atraso mínimo é o intervalo do cron; o preço vem da Hyperliquid (mark) e pode diferir alguns
dólares da Binance; se o iPhone estiver sem rede, a notificação chega depois.
