"use client";
/**
 * Dashboard do Terminal 5.0: acompanhamento de posições alavancadas e contas OKX.
 * Só mostra dados reais. Fontes ainda não conectadas aparecem como estado vazio, nunca com valores de exemplo.
 */
import { NexusHorizon } from "@/components/nexus-art";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChartLine, NotebookPen, ShieldCheck } from "lucide-react";

import { type EvoCcy, type EvoPeriod } from "@bst/domain";
import { AllocationPanel, AssetPerfPanel, EvolutionPanel, FundingFeesPanel, HlSummaryPanel, HubKpis, IntegrationsPanel, LongShortPanel, MarginPanel, PerfAnalyticsCard, PerpsTable, RadarCard, useHub } from "./hub";

import { useIntegrations } from "@/components/nav";


export default function DashboardPage() {
  const [period,setPeriod] = useState<EvoPeriod>("30");
  const [hccy,setHccy] = useState<EvoCcy>("USD");
  const hub = useHub(period,hccy);
  const sources = useIntegrations();
  const connected = sources.filter(x=>x.state !== "none");
  const healthy = connected.length > 0 && connected.every(x=>x.state === "ok");
  const latest = Math.max(0,...connected.map(x=>x.at ?? 0));
  return (
    <div className="nexus-dashboard pt-5">
      <div className="nexus-hero mb-4 flex flex-wrap items-center justify-between gap-3">
        <NexusHorizon />
        <div>
          <p className="mb-1 text-[13px] text-ink-2">Olá, Pedro</p>
          <h1 className="text-[26px] font-bold tracking-[-0.03em] lg:text-[32px]">Visão Geral</h1>
          <p className="mt-1 text-[13px] text-ink-2">Seu centro de comando para posições alavancadas e OKX</p>
        </div>
        <div className="nexus-hero-actions"><Link href="/ajustes" className="nexus-sync"><span className={healthy ? "bg-gain" : "bg-warn"} /><div>{healthy ? "Fontes atualizadas" : "Verificar conexões"}<small>{latest ? `Última leitura: ${new Date(latest).toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit"})}` : "Aguardando fontes"}</small></div></Link></div>
      </div>

      <div className="mb-4"><HubKpis h={hub} period={period} ccy={hccy} /></div>

      <div className="nexus-grid grid gap-4 lg:grid-cols-12 lg:items-stretch">
        <EvolutionPanel h={hub} period={period} setPeriod={setPeriod} ccy={hccy} setCcy={setHccy} className="nexus-evolution lg:col-span-6" />
        <AllocationPanel h={hub} className="nexus-allocation lg:col-span-3" />
        <AssetPerfPanel h={hub} period={period} className="nexus-asset-perf lg:col-span-3" />
        <PerpsTable className="nexus-perps lg:col-span-7" />
        <RadarCard className="nexus-radar lg:col-span-5" />
      </div>
      <div className="nexus-footer nexus-footer-accounts">
        {[{href:"/inteligencia",title:"Performance Analytics",desc:"Análise de resultados e contribuição por ativo.",icon:ChartLine},{href:"/diario",title:"Trading Journal",desc:"Histórico, estatísticas e padrões das operações.",icon:NotebookPen},{href:"/risco",title:"Risk Center",desc:"Riscos, margem, liquidação e simulação de cenários.",icon:ShieldCheck}].map(x=><Link key={x.href} href={x.href} className="nexus-shortcut"><span className="flex items-center gap-2"><x.icon className="size-7 text-accent" />{x.title}</span><p>{x.desc}</p><ArrowUpRight /></Link>)}
      </div>
      <details className="nexus-extras"><summary>Análises complementares e personalização</summary><div className="grid gap-4 lg:grid-cols-12">
        <MarginPanel className="lg:col-span-4" /><LongShortPanel className="lg:col-span-4" /><FundingFeesPanel className="lg:col-span-4" />
        <HlSummaryPanel className="lg:col-span-4" /><IntegrationsPanel className="lg:col-span-4" /><PerfAnalyticsCard className="lg:col-span-4" />

      </div></details>

    </div>
  );
}
