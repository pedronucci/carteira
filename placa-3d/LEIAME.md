# Placa de mesa: Milena Franconere, Escrivã de Polícia

Arquivo principal: `placa_milena_franconere.3mf` (abra no Bambu Studio). Prévias: `render_*.png`.

## Peças (uma única mesa da A1, 256x256)
1. **Placa** (240 x 93 mm, impressa deitada, face para cima, sem suportes). Cores já atribuídas:
   - Filamento 1 **Preto**: corpo, aro do distintivo, letras e frisos gravados
   - Filamento 2 **Dourado**: MILENA (chanfrado), face do distintivo, fitas, louros e linha
   - Filamento 3 **Branco**: FRANCONERE, ESCRIVÃ DE POLÍCIA, listras e emblema do brasão, textos das fitas vermelhas
   - Filamento 4 **Vermelho**: chefe do brasão e fitas "POLÍCIA CIVIL" / "SÃO PAULO"
2. **Base** (246 x 50 x 15 mm, preta) com fenda de 6,4 mm. A lingueta da placa encaixa nela.

## Configuração sugerida
- PLA (dourado silk fica muito bonito), bico de 0,4
- Camada de **0,16 mm** recomendada: os textos das fitas vermelhas têm cerca de 2,7 mm
- Mantenha o gerador de paredes "Arachne" (padrão do Bambu Studio), que imprime os frisos finos de 0,4 a 0,5 mm
- Os relevos foram feitos em múltiplos de 0,2 mm. Com 0,16 mm também funciona.

## Louros verdes (opcional)
O AMS lite tem 4 cores, então os louros saem dourados com contorno preto em relevo.
Para ficar como a foto, pinte as folhas com caneta acrílica verde (posca); o contorno em relevo serve de guia.

## Alternativa
Pasta `stl/`: uma STL por cor. Importe as quatro `placa_*.stl` juntas e responda "Sim" para "objeto único com várias peças".

`gerar_placa.py` gera tudo de novo (`python3 gerar_placa.py .`).
