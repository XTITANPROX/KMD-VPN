// Lightweight tag helper: tags are stored as a JSON array in a TEXT column and
// exposed as plain strings everywhere else (used for users, nodes and panels).

export function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  const raw = value.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean).slice(0, 20);
    } catch {
      /* fall through to comma parsing */
    }
  }
  return raw
    .split(/[,،\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function serializeTags(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const list = Array.isArray(input) ? input : parseTags(String(input));
  const cleaned = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))].slice(0, 20);
  return cleaned.length ? JSON.stringify(cleaned) : null;
}

/** SQL fragment + parameter that matches any of the given tags. */
export function tagFilter(column: string, tag: string): { clause: string; params: string[] } {
  return { clause: `${column} LIKE ?`, params: [`%"${tag.replace(/["%_]/g, "")}"%`] };
}
