"use client";
/** Módulo ainda em construção: estado vazio honesto, sem dados de exemplo. */
import Link from "next/link";
import { Panel } from "@/components/ui";

const INFO: Record<string, { title: string; phase: string; what: string[] }> = {
  "/portfolio": { title: "Portfólio Consolidado", phase: "Fases 3 e 4", what: ["Patrimônio total de Hyperliquid, OKX, carteiras EVM, Bitcoin e Solana, sem contagem dupla", "Tabela de posições por ativo e por local de custódia", "Distribuição por ativo, instituição e rede", "Cadastro manual e importação CSV"] },
  "/trading": { title: "Trading", phase: "Fase 5", what: ["Posições abertas em derivativos de todas as contas", "Preço médio, mark, nocional, margem, liquidação e funding por instrumento"] },
  "/risco": { title: "Risk Center", phase: "Fase 5", what: ["Exposição nocional, líquida e bruta", "Concentração por ativo e por exchange", "Simulador de BTC de −20% a +20% sobre as posições reais"] },
  "/inteligencia": { title: "Performance Intelligence", phase: "Fase 5", what: ["Retorno ponderado pelo tempo e pelo dinheiro", "Volatilidade, Sharpe e queda máxima (só com dados suficientes)", "Resultado por ativo, exchange, estratégia e ciclo"] },
  "/diario": { title: "Trading Journal", phase: "Fase 5", what: ["Registro de operações com justificativa, stop e alvos", "Estatísticas de execução, separadas da contabilidade"] },
};

export function Pending({ path }: { path: string }) {
  const i = INFO[path]!;
  return (
    <div className="pt-5">
      <h1 className="text-[20px] font-semibold tracking-tight">{i.title}</h1>
      <Panel className="mt-4 max-w-2xl p-5">
        <p className="lbl text-accent">Em construção · {i.phase}</p>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-2">Este módulo ainda não tem dados. Ele não mostra valores de exemplo: os números aparecem quando a funcionalidade estiver pronta e as contas, conectadas.</p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-muted">{i.what.map((w) => <li key={w} className="flex gap-2"><span className="text-accent">·</span>{w}</li>)}</ul>
        <Link href="/estrategia" className="mt-4 inline-flex text-[13px] font-medium text-gold">Ir para a Estratégia BTC/USDC ›</Link>
      </Panel>
    </div>
  );
}
