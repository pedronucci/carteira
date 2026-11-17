export class GatewayError extends Error {
  constructor(public readonly reason: "session" | "network" | "server", message: string) { super(message); }
}
/** Não segue o login do Access por fetch: o redirecionamento vira erro CORS opaco. */
export async function gatewayApi<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { ...init, credentials: "same-origin", redirect: "manual", signal: init?.signal ?? AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new GatewayError("network", "Não foi possível alcançar o gateway. Confira a conexão e tente novamente. Os saldos e as credenciais salvas foram preservados.");
  }
  if (r.type === "opaqueredirect" || r.status >= 300 && r.status < 400 || r.status === 401 || r.status === 403)
    throw new GatewayError("session", "Sua sessão de acesso ao terminal expirou ou precisa de autenticação. Entre novamente no terminal; não é necessário cadastrar outra chave OKX.");
  if (!(r.headers.get("Content-Type") ?? "").includes("application/json"))
    throw new GatewayError("server", "O gateway não retornou uma resposta válida. Tente novamente.");
  let j: T & { ok?: boolean; error?: string };
  try { j = await r.json(); } catch { throw new GatewayError("server", "Resposta incompleta do gateway. Tente novamente."); }
  if (!r.ok || j.ok === false) throw new GatewayError("server", j.error ?? `Gateway respondeu ${r.status}.`);
  return j;
}

/** Query nova evita que o service worker use a página offline em vez do login. */
export function gatewayLoginUrl(current:string,now=Date.now()){const url=new URL(current);url.searchParams.set("bst_reauth",String(now));return url.href;}
