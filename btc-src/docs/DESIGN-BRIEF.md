# Direção visual — Terminal 5.0 "Institutional Future" (aprovada em 07/11/2026)

Substitui a identidade amarela e laranja da versão 4. Modo: **Operate** (ferramenta de trabalho):
densidade, precisão e leitura rápida valem mais que efeito.

## Cores (tokens em `apps/local/src/app/globals.css`)
| Papel | Cor | Uso |
|---|---|---|
| Fundo | `#090E16` | página |
| Superfícies | `#111A27` · `#172334` · `#1F2D42` | painéis, campos, hover |
| Linhas | `#1D2A3C` · `#2B3C54` | bordas finas |
| Texto | `#EEF3FA` · `#C5D0DE` · `#91A2B8` | principal, secundário, rótulos |
| **Ciano** | `#42D9D0` | interação e estado: seleção, foco, botão principal, conexão |
| **Dourado** | `#D7B36A` | só a Estratégia BTC/USDC: navegação, cartão da Dashboard, linha da estratégia nos gráficos |
| BTC | `#F7931A` | só o ativo Bitcoin (ícone, posição, "Só BTC") |
| Lucro, prejuízo, alerta | `#36C995` · `#EF6878` · `#E8B04B` | sempre com sinal ou texto, nunca só pela cor |

## Tipografia
Inter para os textos e JetBrains Mono para os números, com algarismos de largura fixa. Rótulos de dado em caixa alta pequena (`.lbl`).

## Estrutura
- **Desktop:** barra lateral recolhível com os 9 módulos (a Estratégia sempre em dourado) e cabeçalho com o BTC, o estado das integrações, BRL/USD, privacidade e ajustes.
- **Celular:** barra inferior com Início, Estratégia, Portfólio, Mercado e Mais; os demais módulos ficam em "Mais".
- **Painéis:** borda fina e cantos de 8 px; indicadores em grade separada por linhas (sem cartões dentro de cartões); régua de risco horizontal.
- **Estados vazios honestos:** módulo não pronto ou integração não conectada mostra isso, nunca valores de exemplo.
