# Brief de design — evolução para terminal profissional

Escopo: **refinamento** da identidade atual, não redesenho. Ficam o tema escuro, o amarelo de destaque, o laranja do BTC, as quatro abas, BRL/USD, todas as funções e todos os textos. Modo da superfície: **Operate**.

Decisões confirmadas pelo usuário (07/11/2026):

| Tema | Decisão |
|---|---|
| Densidade | **Terminal denso**: faixa de KPIs no topo (patrimônio, P&L do ciclo, exposição, alavancagem, distância da liquidação), cards compactos, mais dados por tela |
| Números | **Fonte monoespaçada técnica** para preços, saldos e percentuais, com colunas alinhadas. Textos continuam em Inter |
| Medidor de exposição | Trocar o semicírculo por uma **barra de risco** horizontal, com faixas e marcador da liquidação |
| Desktop | **Painel em colunas** em telas largas. No iPhone continua uma coluna com abas |

Pontos observados nas capturas atuais:
- Cantos muito arredondados e botões em pílula dão cara de app de consumo. Usar raios menores e bordas finas.
- Os títulos dos cards são grandes demais para um terminal. Usar rótulos em caixa alta pequenos e números como protagonistas.
- Mostrar o estado da conexão (fonte, há quanto tempo atualizou, ao vivo ou manual) como barra de status discreta.
- O P&L do ciclo e o percentual precisam ser coerentes entre as abas (hoje há −1,62% e −2,65% para o mesmo período; isso é um erro de cálculo, ver AUDITORIA.md).

A implementação começa quando o código-fonte estiver em `btc-src/`.
