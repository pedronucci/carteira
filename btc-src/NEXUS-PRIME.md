# NEXUS PRIME — revisão visual

Branch: `redesign/nexus-prime`, baseada no commit publicado `45cc7d1`. Esse commit e os backups anteriores são o ponto de restauração. A branch não foi publicada nem mesclada em main.

## Alterações

- `apps/local/src/components/nav.tsx`: marca geométrica, sidebar, seleção ciano e organização das rotas existentes.
- `apps/local/src/components/nexus-art.tsx`: horizonte Bitcoin e terreno vetorial inline, sem recursos de terceiros.
- `apps/local/src/app/globals.css`: paleta, componentes, foco, responsividade e composição NEXUS PRIME.
- `apps/local/src/app/dashboard/page.tsx`: composição dos painéis, estado das fontes e atalhos dos módulos reais.
- `apps/local/src/app/dashboard/hub.tsx`: apresentação dos indicadores, centro da rosca e barras de desempenho.

Nenhuma biblioteca adicionada. Reutilizados React, Lucide, Recharts e os componentes existentes. Nenhuma alteração nos motores financeiros, integrações ou persistência. A informação de estado usa os dados já disponíveis de integração.

## Validação

356 testes aprovados; typecheck dos quatro pacotes; build no Windows. Navegação pelos oito módulos principais, modal de cadastro, desktop 1672×1050 e iPhone 390×844, temas escuro/claro. Sem erros no console na navegação observada. A ordem dos painéis no iPhone foi corrigida após inspeção.

Capturas e galeria na pasta `nexus-prime` da raiz do workspace, fora do repositório. Sem importação dos dados pessoais para a origem localhost: ausência de posição, séries e contas nos prints representa o estado real dessa origem. Gráficos preenchidos com dados pessoais ainda precisam de revisão nessa instalação.

A arte é uma interpretação vetorial leve da referência, não uma reprodução fotográfica. Preservadas funcionalidades e painéis complementares abaixo da composição principal. Produção aguarda aprovação explícita desta revisão.

## Prévia

Do diretório `publicacao/repositorio`: `python -m http.server 8766 --bind 127.0.0.1 --directory btc-src/apps/local/dist`. Abra `http://127.0.0.1:8766`.
