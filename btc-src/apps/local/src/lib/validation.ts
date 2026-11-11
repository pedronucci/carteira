/** Validação de fronteira antes de importar ou persistir valores financeiros. */
export function finite(value: unknown, label: string, min = -Infinity): number {
  if (value === "" || value == null || typeof value !== "number" && typeof value !== "string") throw new Error(`${label}: número obrigatório.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${label}: valor inválido.`);
  return n;
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}: objeto inválido.`);
  return value as Record<string, unknown>;
}
export function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100000) throw new Error(`${label}: lista inválida ou grande demais.`);
  return value.map((x) => record(x, label));
}
export function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 10000) throw new Error(`${label}: texto obrigatório ou longo demais.`);
  return value;
}
export function unique(list: Record<string, unknown>[], field: string, label: string) {
  const seen = new Set<string>();
  for (const r of list) { const id = nonempty(r[field], label); if (seen.has(id)) throw new Error(`${label}: identificador repetido.`); seen.add(id); }
}
export function dateValue(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Date.parse(nonempty(value, label));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: data inválida.`);
  return n;
}
