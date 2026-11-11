/** CSV com campos entre aspas, aspas escapadas e quebras de linha dentro do campo. */
export function csvRows(text: string, separator: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (c === '"') { if (quoted && input[i + 1] === '"') { field += '"'; i++; } else if (quoted || !field.trim()) quoted = !quoted; else throw new Error("Aspas inválidas no CSV."); }
    else if (c === separator && !quoted) { row.push(field.trim()); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && input[i + 1] === "\n") i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (quoted) throw new Error("Campo entre aspas não foi fechado.");
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function csvNumber(value: string | undefined, locale: "pt-BR" | "en-US"): string {
  const s = (value ?? "").trim(); if (!s) return "";
  const grammar = locale === "pt-BR" ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/ : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
  if (!grammar.test(s)) return "NaN";
  return locale === "pt-BR" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
}
