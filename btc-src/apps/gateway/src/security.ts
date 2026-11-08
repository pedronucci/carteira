/**
 * Segurança do gateway: autenticação (Cloudflare Access), cifra das credenciais e assinatura da OKX.
 * Só Web Crypto (sem dependências). Nenhuma função aqui registra valores em log.
 */

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const unb64url = (s: string) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

// ───────── Cloudflare Access (JWT RS256) ─────────

export interface AccessConfig { teamDomain: string; aud: string; ownerEmail: string }
/** Aceita o domínio da equipe colado com https://, barra no fim, espaços ou maiúsculas. */
export const normTeamDomain = (d: string) => (d ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
type Jwk = JsonWebKey & { kid: string };
let jwks: { at: number; keys: Jwk[] } | null = null;

async function keys(teamDomain: string, f: typeof fetch): Promise<Jwk[]> {
  if (jwks && Date.now() - jwks.at < 3600e3) return jwks.keys;
  const r = await f(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("Não foi possível obter as chaves do Cloudflare Access.");
  const j = (await r.json()) as { keys: Jwk[] };
  jwks = { at: Date.now(), keys: j.keys };
  return j.keys;
}
export const resetJwksCache = () => { jwks = null; };

/**
 * Valida o token do Cloudflare Access (cabeçalho Cf-Access-Jwt-Assertion): assinatura RS256 com a chave pública
 * da equipe, emissor, audiência (AUD do aplicativo), validade e o e-mail do dono. Qualquer falha = sem acesso.
 */
export async function verifyAccess(token: string | null, cfg: AccessConfig, f: typeof fetch = fetch): Promise<{ email: string }> {
  if (!token) throw new AuthError("Sem token do Cloudflare Access.");
  const team = normTeamDomain(cfg.teamDomain);
  if (!team) throw new AuthError("ACCESS_TEAM_DOMAIN não configurado no Worker.");
  if (!(cfg.aud ?? "").trim()) throw new AuthError("ACCESS_AUD não configurado no Worker.");
  if (!(cfg.ownerEmail ?? "").trim()) throw new AuthError("OWNER_EMAIL não configurado no Worker.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Token malformado.");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(dec.decode(unb64url(h))) as { alg: string; kid: string };
  if (header.alg !== "RS256") throw new AuthError("Algoritmo de assinatura não aceito.");
  const jwk = (await keys(team, f)).find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError("Chave de assinatura desconhecida.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, unb64url(s), enc.encode(`${h}.${p}`));
  if (!ok) throw new AuthError("Assinatura inválida.");
  const c = JSON.parse(dec.decode(unb64url(p))) as { aud: string | string[]; iss: string; exp: number; nbf?: number; email?: string };
  const now = Math.floor(Date.now() / 1000);
  if (normTeamDomain(c.iss) !== team) throw new AuthError(`Emissor inválido: o token é de "${normTeamDomain(c.iss)}", mas ACCESS_TEAM_DOMAIN é "${team}".`);
  if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(cfg.aud.trim())) throw new AuthError("Audiência inválida (confira ACCESS_AUD).");
  if (c.exp <= now || (c.nbf && c.nbf > now + 60)) throw new AuthError("Token expirado.");
  if (!c.email || c.email.toLowerCase() !== cfg.ownerEmail.trim().toLowerCase()) throw new AuthError("Usuário não autorizado (confira OWNER_EMAIL).");
  return { email: c.email };
}
export class AuthError extends Error {}

// ───────── credenciais cifradas (AES-GCM 256) ─────────

/**
 * Bytes da MASTER_KEY. Formato recomendado: 32 bytes em base64 (`openssl rand -base64 32`), aceito também com
 * espaços, aspas ou em base64url. Sem como gerar isso (ex.: só com o iPhone), aceita uma senha aleatória longa
 * (≥ 32 caracteres), transformada em 32 bytes por SHA-256. Mais curta que isso é recusada.
 */
export async function masterKeyBytes(master: string | undefined): Promise<Uint8Array> {
  const t = (master ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (!t) throw new KeyConfigError("MASTER_KEY não configurada no Worker (Settings → Variables and Secrets, tipo Secret).");
  const b = t.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(b)) {
    try { const raw = unb64(b + "===".slice((b.length + 3) % 4)); if (raw.length === 32) return raw; } catch { /* não é base64 */ }
  }
  if (t.length >= 32) return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(t)));
  throw new KeyConfigError("MASTER_KEY inválida: use 32 bytes em base64 (openssl rand -base64 32) ou uma senha aleatória com pelo menos 32 caracteres.");
}
export class KeyConfigError extends Error {}
async function aesKey(master: string) {
  return crypto.subtle.importKey("raw", await masterKeyBytes(master), "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** Cifra um objeto. O resultado (iv + texto cifrado) não revela nada sem a MASTER_KEY. */
export async function seal(obj: unknown, masterB64: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, await aesKey(masterB64), enc.encode(JSON.stringify(obj)));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function open<T>(sealed: string, masterB64: string, aad: string): Promise<T> {
  const [iv, ct] = sealed.split(".");
  if (!iv || !ct) throw new Error("Credencial guardada corrompida.");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(aad) }, await aesKey(masterB64), unb64(ct));
  return JSON.parse(dec.decode(pt)) as T;
}

// ───────── assinatura OKX v5 ─────────

/** OK-ACCESS-SIGN = Base64(HMAC-SHA256(timestamp + MÉTODO + caminho(+query) + corpo, SecretKey)). */
export async function okxSign(secret: string, ts: string, method: string, path: string, body = ""): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, enc.encode(ts + method.toUpperCase() + path + body)));
}
