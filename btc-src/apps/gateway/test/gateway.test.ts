/** Gateway: segurança (Access, cifra, assinatura), API da OKX somente leitura e normalização sem contagem dupla. */
import { createHmac, generateKeyPairSync, createSign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { masterKeyBytes, okxSign, open, resetJwksCache, seal, verifyAccess } from "../src/security";
import { normalize } from "../src/okx";
import { handleApi, scheduledSnapshot, type Env } from "../src/index";

const MASTER = Buffer.alloc(32, 7).toString("base64");
const TEAM = "minhaequipe.cloudflareaccess.com", AUD = "aud-123", OWNER = "dono@example.com";

// ───────── JWT de teste (RS256) ─────────
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256", use: "sig" };
const b64u = (x: Buffer | string) => Buffer.from(x).toString("base64url");
function jwt(claims: Record<string, unknown>, kid = "k1") {
  const h = b64u(JSON.stringify({ alg: "RS256", kid })), p = b64u(JSON.stringify(claims));
  const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey);
  return `${h}.${p}.${b64u(s)}`;
}
const now = () => Math.floor(Date.now() / 1000);
const good = () => jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, email: OWNER });

// ───────── KV e OKX simulados ─────────
class MemKV { m = new Map<string, string>(); async get(k: string, t?: string) { const v = this.m.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; } async put(k: string, v: string) { this.m.set(k, v); } async delete(k: string) { this.m.delete(k); } }
let perm = "read_only";
let calls: string[] = [];
const okxData: Record<string, unknown> = {
  "/api/v5/account/config": [{ perm: "read_only", label: "bst", ip: "" }],
  "/api/v5/account/balance": [{ totalEq: "1500.5", details: [{ ccy: "USDT", eq: "1000", cashBal: "1000", availBal: "900", frozenBal: "100", eqUsd: "1000.1", upl: "0" }, { ccy: "BTC", eq: "0.005", cashBal: "0.005", availBal: "0.005", frozenBal: "0", eqUsd: "500.4", upl: "12" }] }],
  "/api/v5/asset/balances": [{ ccy: "ETH", bal: "37.11827078", frozenBal: "0", availBal: "37.11827078" }],
  "/api/v5/account/positions": [{ instType: "SWAP", instId: "BTC-USDT-SWAP", mgnMode: "cross", posSide: "net", pos: "-3", avgPx: "100000", markPx: "99000", upl: "30", notionalUsd: "297", lever: "5", liqPx: "120000", margin: "", imr: "59.4", ccy: "USDT" }],
  "/api/v5/finance/savings/balance": [{ ccy: "USDC", amt: "250", earnings: "1.2" }],
  "/api/v5/asset/deposit-history?limit=100": [{ ccy: "USDC", chain: "USDC-Arbitrum One", amt: "500", txId: "0xabc", ts: "1793000000000", state: "2", depId: "d1", from: "", to: "0xdep" }, { ccy: "BTC", chain: "BTC-Bitcoin", amt: "0.1", txId: "tx2", ts: "1793000000001", state: "0", depId: "d2", from: "", to: "bc1" }],
  "/api/v5/asset/withdrawal-history?limit=100": [{ ccy: "USDC", chain: "USDC-Arbitrum One", amt: "200", txId: "0xdef", ts: "1793100000000", state: "2", wdId: "w1", to: "0xrabby", fee: "0.1", feeCcy: "USDC" }],
  "/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP": [{ instId: "BTC-USDT-SWAP", ctVal: "0.01", ctValCcy: "BTC", ctMult: "1" }],
};
const fakeFetch: typeof fetch = async (input, init) => {
  const u = new URL(String(input));
  if (u.hostname === TEAM) return new Response(JSON.stringify({ keys: [jwk] }));
  const path = u.pathname + u.search;
  calls.push(`${init?.method ?? "GET"} ${path}`);
  const h = new Headers(init?.headers);
  if (!path.startsWith("/api/v5/public/") && (!h.get("OK-ACCESS-KEY") || !h.get("OK-ACCESS-SIGN") || !h.get("OK-ACCESS-PASSPHRASE"))) return new Response(JSON.stringify({ code: "50103", msg: "", data: [] }), { status: 401 });
  if (h.get("OK-ACCESS-KEY") === "wrong") return new Response(JSON.stringify({ code: "50111", msg: "Invalid OK-ACCESS-KEY", data: [] }), { status: 401 });
  const data = path === "/api/v5/account/config" ? [{ perm, label: "bst", ip: "" }] : okxData[path];
  return new Response(JSON.stringify({ code: "0", msg: "", data: data ?? [] }));
};
let kv: MemKV;
const env = (): Env => ({ ASSETS: {} as Fetcher, BST: kv as unknown as KVNamespace, MASTER_KEY: MASTER, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, OWNER_EMAIL: OWNER });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://bst.example.workers.dev${path}`, { method, headers: { "Cf-Access-Jwt-Assertion": good(), "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
const creds = { apiKey: "key-1234", secret: "s3cr3t-value", passphrase: "Minha-Pass" };

beforeEach(() => { kv = new MemKV(); perm = "read_only"; calls = []; resetJwksCache(); });

describe("assinatura OKX", () => {
  it("igual ao HMAC-SHA256 em Base64 da documentação (timestamp + método + caminho + corpo)", async () => {
    const ts = "2020-12-08T09:08:57.715Z";
    const expected = createHmac("sha256", "SEGREDO").update(ts + "GET" + "/api/v5/account/balance?ccy=BTC").digest("base64");
    expect(await okxSign("SEGREDO", ts, "get", "/api/v5/account/balance?ccy=BTC")).toBe(expected);
  });
});

describe("cifra das credenciais", () => {
  it("ida e volta; adulterar ou mudar o contexto falha", async () => {
    const s = await seal(creds, MASTER, "okx-creds-v1");
    expect(s).not.toContain("s3cr3t");
    expect(await open(s, MASTER, "okx-creds-v1")).toEqual(creds);
    await expect(open(s, MASTER, "outro-contexto")).rejects.toThrow();
    const [iv, ct] = s.split(".");
    const flipped = `${iv}.${ct!.slice(0, -4)}AAAA`;
    await expect(open(flipped, MASTER, "okx-creds-v1")).rejects.toThrow();
    await expect(open(s, Buffer.alloc(32, 9).toString("base64"), "okx-creds-v1")).rejects.toThrow();
  });
});

describe("MASTER_KEY", () => {
  it("aceita base64 com espaços/aspas/base64url e senha longa; recusa curta, vazia e inválida", async () => {
    const raw = Buffer.alloc(32, 7);
    for (const m of [MASTER, ` ${MASTER}\n`, `"${MASTER}"`, raw.toString("base64url")]) expect(Buffer.from(await masterKeyBytes(m))).toEqual(raw);
    expect((await masterKeyBytes("uma-senha-aleatória-bem-longa-com-32+caracteres!")).length).toBe(32);
    for (const m of ["", undefined, "curta!", "não é base64 ç"]) await expect(masterKeyBytes(m)).rejects.toThrow(/MASTER_KEY/);
    const s = await seal({ a: 1 }, ` ${MASTER} `, "x");
    expect(await open(s, MASTER, "x")).toEqual({ a: 1 });
  });
  it("conectar com MASTER_KEY inválida: mensagem clara, sem chamar a OKX nem guardar nada", async () => {
    const r = await handleApi(req("POST", "/api/okx/credentials", creds), { ...env(), MASTER_KEY: "curta" }, fakeFetch);
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).toMatch(/MASTER_KEY inválida/);
    expect(kv.m.has("okx:creds")).toBe(false);
  });
});

describe("Cloudflare Access", () => {
  const cfg = { teamDomain: TEAM, aud: AUD, ownerEmail: OWNER };
  it("aceita só o token válido do dono", async () => {
    await expect(verifyAccess(good(), cfg, fakeFetch)).resolves.toEqual({ email: OWNER });
  });
  it.each([
    ["sem token", null],
    ["outra audiência", jwt({ aud: ["x"], iss: `https://${TEAM}`, exp: now() + 600, email: OWNER })],
    ["outro emissor", jwt({ aud: [AUD], iss: "https://outro.cloudflareaccess.com", exp: now() + 600, email: OWNER })],
    ["expirado", jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: now() - 10, email: OWNER })],
    ["outro e-mail", jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, email: "intruso@example.com" })],
    ["chave desconhecida", jwt({ aud: [AUD], iss: `https://${TEAM}`, exp: now() + 600, email: OWNER }, "k9")],
    ["assinatura adulterada", good().slice(0, -6) + "AAAAAA"],
  ])("recusa: %s", async (_n, t) => { await expect(verifyAccess(t as string | null, cfg, fakeFetch)).rejects.toThrow(); });
  it("aceita o domínio da equipe colado com https://, barra, espaços ou maiúsculas", async () => {
    for (const d of [`https://${TEAM}`, `${TEAM}/`, ` ${TEAM} `, `https://${TEAM.toUpperCase()}/`])
      await expect(verifyAccess(good(), { ...cfg, teamDomain: d }, fakeFetch)).resolves.toEqual({ email: OWNER });
  });
  it("erro diz qual variável conferir", async () => {
    await expect(verifyAccess(good(), { ...cfg, teamDomain: "" }, fakeFetch)).rejects.toThrow(/ACCESS_TEAM_DOMAIN não configurado/);
    const t = jwt({ aud: [AUD], iss: "https://outro.cloudflareaccess.com", exp: now() + 600, email: OWNER });
    await expect(verifyAccess(t, cfg, fakeFetch)).rejects.toThrow(/outro\.cloudflareaccess\.com/);
  });
});

describe("API do gateway", () => {
  it("sem login do Access: 401; de outra origem: 403", async () => {
    const r1 = await handleApi(new Request("https://bst.example.workers.dev/api/health"), env(), fakeFetch);
    expect(r1.status).toBe(401);
    const r2 = await handleApi(req("GET", "/api/health", undefined, { Origin: "https://evil.example" }), env(), fakeFetch);
    expect(r2.status).toBe(403);
  });
  it("recusa chave com permissão de trade/saque e não guarda nada", async () => {
    perm = "read_only,trade";
    const r = await handleApi(req("POST", "/api/okx/credentials", creds), env(), fakeFetch);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/permissões além de leitura/);
    expect(kv.m.has("okx:creds")).toBe(false);
  });
  it("recusa frase de recuperação no lugar da passphrase da API", async () => {
    const r = await handleApi(req("POST", "/api/okx/credentials", { ...creds, passphrase: "abandon ".repeat(11) + "about" }), env(), fakeFetch);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/frase de recuperação/);
  });
  it("chave somente leitura: guarda cifrada, nunca devolve o segredo, e sincroniza", async () => {
    const r = await handleApi(req("POST", "/api/okx/credentials", creds), env(), fakeFetch);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).not.toContain("s3cr3t"); expect(body).not.toContain("Minha-Pass");
    expect(kv.m.get("okx:creds")).not.toContain("s3cr3t");
    const st = (await (await handleApi(req("GET", "/api/okx/status"), env(), fakeFetch)).json()) as { connected: boolean; meta: { keyHint: string } };
    expect(st.connected).toBe(true);
    expect(st.meta.keyHint).toBe("…1234");
    const snap = (await (await handleApi(req("GET", "/api/okx/snapshot"), env(), fakeFetch)).json()) as { snapshot: { holdings: unknown[]; positions: unknown[] } };
    expect(snap.snapshot.holdings.length).toBe(4);
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true); // somente leitura
  });
  it("credencial inválida vira mensagem clara", async () => {
    const r = await handleApi(req("POST", "/api/okx/credentials", { ...creds, apiKey: "wrong" }), env(), fakeFetch);
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/API Key inválida/);
  });
  it("limite de frequência: segunda leitura imediata devolve o cache", async () => {
    await handleApi(req("POST", "/api/okx/credentials", creds), env(), fakeFetch);
    await handleApi(req("GET", "/api/okx/snapshot"), env(), fakeFetch);
    const n0 = calls.length;
    const r = (await (await handleApi(req("GET", "/api/okx/snapshot"), env(), fakeFetch)).json()) as { cached: boolean };
    expect(r.cached).toBe(true);
    expect(calls.length).toBe(n0);
  });
  it("revogar apaga as credenciais do gateway", async () => {
    await handleApi(req("POST", "/api/okx/credentials", creds), env(), fakeFetch);
    const r = await handleApi(req("DELETE", "/api/okx/credentials"), env(), fakeFetch);
    expect(r.status).toBe(200);
    expect(kv.m.has("okx:creds")).toBe(false);
    expect((await handleApi(req("GET", "/api/okx/snapshot"), env(), fakeFetch)).status).toBe(404);
  });
  it("retrato por hora (cron) acumula o histórico", async () => {
    await handleApi(req("POST", "/api/okx/credentials", creds), env(), fakeFetch);
    await scheduledSnapshot(env(), fakeFetch);
    await scheduledSnapshot(env(), fakeFetch);
    expect(JSON.parse(kv.m.get("okx:history")!)).toHaveLength(2);
  });
});

describe("normalização OKX (campos da documentação)", () => {
  const s = normalize({
    bal: (okxData["/api/v5/account/balance"] as never[])[0], fund: okxData["/api/v5/asset/balances"] as never, pos: okxData["/api/v5/account/positions"] as never,
    inst: okxData["/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP"] as never, sav: okxData["/api/v5/finance/savings/balance"] as never,
    dep: okxData["/api/v5/asset/deposit-history?limit=100"] as never, wd: okxData["/api/v5/asset/withdrawal-history?limit=100"] as never,
  }, 1);
  it("trading pelo patrimônio de cada moeda (eqUsd), funding e Earn como contas separadas", () => {
    expect(s.holdings.filter((h) => h.accountId === "okx-trading").reduce((x, h) => x + (h.valueUsd ?? 0), 0)).toBeCloseTo(1500.5);
    expect(s.holdings.find((h) => h.accountId === "okx-funding")).toMatchObject({ econ: "ETH", qty: "37.11827078", kind: "spot" });
    expect(s.holdings.find((h) => h.accountId === "okx-earn")).toMatchObject({ econ: "USDC", qty: "250", kind: "earn" });
  });
  it("posição: contratos × ctVal; short pelo sinal; nunca somada (não vira saldo)", () => {
    expect(s.positions[0]).toMatchObject({ instrument: "BTC-USDT-SWAP", dir: "SHORT", size: 0.03, notional: 297, liq: 120000 });
    expect(s.holdings.some((h) => h.assetKey.includes("SWAP"))).toBe(false);
  });
  it("só depósitos e saques concluídos (estado 2), com txid para parear com as carteiras", () => {
    expect(s.events.map((e) => [e.kind, e.qty, e.txid])).toEqual([["deposit", 500, "0xabc"], ["withdraw", 200, "0xdef"]]);
  });
});
