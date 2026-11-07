/**
 * Gateway seguro do Bitcoin Strategy Terminal 5.0 (Cloudflare Worker).
 *
 * - Serve o app (assets estáticos) e a API /api/* no mesmo endereço; o Cloudflare Access protege tudo e o Worker
 *   ainda valida o token do Access em CADA chamada da API (assinatura, audiência, validade, e-mail do dono).
 * - Somente leitura: só endpoints GET da OKX; nenhuma ordem, nenhum saque, nenhuma transferência.
 * - Credenciais da OKX: recebidas uma vez por HTTPS, validadas (a chave precisa ser SOMENTE LEITURA), cifradas
 *   (AES-GCM com MASTER_KEY) e guardadas no KV. Nunca voltam para o navegador e nunca vão para logs.
 * - Sem CORS: chamadas de outras origens são recusadas.
 */
import { AuthError, open, seal, verifyAccess } from "./security";
import { fetchSnapshot, keyInfo, OkxError, type OkxCreds, type OkxSnapshot } from "./okx";
import { solanaTokens } from "./solana";

export interface Env {
  ASSETS: Fetcher;
  BST: KVNamespace;
  MASTER_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  OWNER_EMAIL: string;
  SOLANA_RPC_URL?: string;
}

const K = { creds: "okx:creds", meta: "okx:meta", last: "okx:last", hist: "okx:history", rl: (k: string) => `rl:${k}` };
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Frame-Options": "DENY" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...SEC } });
const fail = (status: number, message: string) => json({ ok: false, error: message }, status);

/** Limite simples por rota (KV): no máximo 1 chamada a cada `sec` segundos. */
async function rateLimit(env: Env, key: string, sec: number): Promise<boolean> {
  const last = Number((await env.BST.get(K.rl(key))) ?? 0);
  if (Date.now() - last < sec * 1000) return false;
  await env.BST.put(K.rl(key), String(Date.now()), { expirationTtl: Math.max(60, sec * 2) });
  return true;
}

async function readCreds(env: Env): Promise<OkxCreds | null> {
  const s = await env.BST.get(K.creds);
  return s ? open<OkxCreds>(s, env.MASTER_KEY, "okx-creds-v1") : null;
}

export async function handleApi(req: Request, env: Env, f: typeof fetch = fetch): Promise<Response> {
  const url = new URL(req.url);
  // só a própria origem (o app servido por este Worker)
  const origin = req.headers.get("Origin");
  if (origin && origin !== url.origin) return fail(403, "Origem não permitida.");
  try { await verifyAccess(req.headers.get("Cf-Access-Jwt-Assertion"), { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, ownerEmail: env.OWNER_EMAIL }, f); }
  catch (e) { return fail(401, e instanceof AuthError ? e.message : "Falha na autenticação."); }
  const route = `${req.method} ${url.pathname}`;
  try {
    switch (route) {
      case "GET /api/health":
        return json({ ok: true, gateway: "bst-gateway", features: { okx: true, solanaTokens: Boolean(env.SOLANA_RPC_URL) } });

      case "GET /api/okx/status": {
        const meta = await env.BST.get(K.meta, "json");
        return json({ ok: true, connected: Boolean(await env.BST.get(K.creds)), meta });
      }

      case "POST /api/okx/credentials": {
        if (!(await rateLimit(env, "okx-cred", 5))) return fail(429, "Aguarde alguns segundos antes de tentar de novo.");
        const len = Number(req.headers.get("Content-Length") ?? 0);
        if (len > 4096) return fail(413, "Corpo grande demais.");
        const b = (await req.json().catch(() => null)) as Partial<OkxCreds> | null;
        const c = { apiKey: String(b?.apiKey ?? "").trim(), secret: String(b?.secret ?? "").trim(), passphrase: String(b?.passphrase ?? "") };
        if (!c.apiKey || !c.secret || !c.passphrase) return fail(400, "Informe API Key, Secret Key e Passphrase da API.");
        if (c.passphrase.trim().split(/\s+/).length >= 12) return fail(400, "Isto parece uma frase de recuperação. Use a Passphrase da API (a senha criada junto com a API Key), nunca a frase da carteira.");
        const info = await keyInfo(c, f);
        if (!info.readOnly) return fail(400, `Esta chave tem permissões além de leitura (${info.perms.join(", ") || "desconhecidas"}). Crie uma API Key só com "Read".`);
        await env.BST.put(K.creds, await seal(c, env.MASTER_KEY, "okx-creds-v1"));
        const meta = { label: info.label, ipBound: info.ipBound, perms: info.perms, connectedAt: Date.now(), keyHint: `…${c.apiKey.slice(-4)}` };
        await env.BST.put(K.meta, JSON.stringify(meta));
        return json({ ok: true, meta });
      }

      case "DELETE /api/okx/credentials":
        await Promise.all([env.BST.delete(K.creds), env.BST.delete(K.meta), env.BST.delete(K.last)]);
        return json({ ok: true, revoked: true, note: "Credenciais apagadas do gateway. Apague também a API Key no site da OKX." });

      case "GET /api/okx/snapshot": {
        const cached = (await env.BST.get(K.last, "json")) as OkxSnapshot | null;
        if (!(await rateLimit(env, "okx-snap", 15))) return cached ? json({ ok: true, cached: true, snapshot: cached }) : fail(429, "Aguarde alguns segundos.");
        const c = await readCreds(env);
        if (!c) return fail(404, "OKX não conectada.");
        const s = await fetchSnapshot(c, f);
        await env.BST.put(K.last, JSON.stringify(s));
        return json({ ok: true, cached: false, snapshot: s });
      }

      case "GET /api/okx/history":
        return json({ ok: true, history: (await env.BST.get(K.hist, "json")) ?? [] });

      case "GET /api/solana/tokens": {
        if (!env.SOLANA_RPC_URL) return fail(501, "Tokens SPL: configure o segredo SOLANA_RPC_URL no gateway.");
        if (!(await rateLimit(env, "sol", 5))) return fail(429, "Aguarde alguns segundos.");
        return json({ ok: true, tokens: await solanaTokens(env.SOLANA_RPC_URL, url.searchParams.get("address") ?? "", f) });
      }
      default:
        return fail(404, "Rota inexistente.");
    }
  } catch (e) {
    if (e instanceof OkxError) return fail(502, e.message);
    return fail(500, (e as Error).message.slice(0, 200));
  }
}

/** Retrato do patrimônio da OKX a cada hora (evolução com o app fechado). */
export async function scheduledSnapshot(env: Env, f: typeof fetch = fetch) {
  const c = await readCreds(env);
  if (!c) return;
  const s = await fetchSnapshot(c, f);
  await env.BST.put(K.last, JSON.stringify(s));
  const hist = ((await env.BST.get(K.hist, "json")) as { t: number; totalEqUsd: number | null; holdings: { accountId: string; econ: string; qty: string; valueUsd?: number | null }[] }[] | null) ?? [];
  hist.push({ t: s.at, totalEqUsd: s.totalEqUsd, holdings: s.holdings.map((h) => ({ accountId: h.accountId, econ: h.econ, qty: h.qty, valueUsd: h.valueUsd })) });
  await env.BST.put(K.hist, JSON.stringify(hist.slice(-2000)));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return handleApi(req, env);
    const r = await env.ASSETS.fetch(req);
    const h = new Headers(r.headers);
    h.set("X-Content-Type-Options", "nosniff"); h.set("Referrer-Policy", "no-referrer"); h.set("X-Frame-Options", "DENY");
    return new Response(r.body, { status: r.status, headers: h });
  },
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledSnapshot(env).catch(() => undefined));
  },
} satisfies ExportedHandler<Env>;
