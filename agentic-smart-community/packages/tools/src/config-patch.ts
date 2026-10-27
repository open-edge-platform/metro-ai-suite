import { createHash } from "node:crypto";

export function fingerprint(value: unknown): string {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "undefined").digest("hex");
}

/** Objects merge recursively; arrays replace. Null never implicitly removes a key. */
export function mergePatch(base: any, patch: any): any {
  const result = structuredClone(base ?? {});
  for (const [key, value] of Object.entries(patch)) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`invalid patch key: ${key}`);
    if (value === null) throw new Error(`null removal is unsupported: ${key}`);
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePatch(result[key], value) : structuredClone(value);
  }
  return result;
}
