import * as fs from 'fs';
import type { RestResponse } from './rest-client';

/**
 * OpenAPI 3.x contract checks without extra dependencies.
 *
 *  - check(response): is the status documented, and does the body match the documented schema?
 *  - coverage(): which documented operations the suite has exercised
 *  - diffOpenApi(a, b): what changed between two versions of the spec (Sentinel)
 *
 * The schema validator covers what APIs use in practice: type, nullable, required,
 * properties, additionalProperties:false, items, enum, oneOf/anyOf/allOf, $ref,
 * minimum/maximum, minLength/maxLength, pattern, and date/date-time formats.
 */

type Json = Record<string, any>;

export interface ContractIssue {
  path: string;
  message: string;
}

interface Op {
  method: string;
  template: string;
  regex: RegExp;
  operation: Json;
}

export class OpenApiContract {
  private ops: Op[] = [];
  private hits = new Set<string>();

  constructor(public readonly doc: Json) {
    for (const [template, item] of Object.entries<Json>(doc.paths ?? {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head']) {
        if (!item[method]) continue;
        const pattern = template
          .split('/')
          .map((seg) => (/^\{[^}]+\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')))
          .join('/');
        const regex = new RegExp(`^${pattern}/?$`);
        this.ops.push({ method: method.toUpperCase(), template, regex, operation: item[method] });
      }
    }
  }

  static load(fileOrJson: string | Json): OpenApiContract {
    if (typeof fileOrJson !== 'string') return new OpenApiContract(fileOrJson);
    return new OpenApiContract(JSON.parse(fs.readFileSync(fileOrJson, 'utf8')));
  }

  static async fetch(url: string): Promise<OpenApiContract> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`OpenAPI ${url} returned ${r.status}`);
    return new OpenApiContract((await r.json()) as Json);
  }

  /** Strips the server base path so "/api/v1/positions/7" matches "/positions/{id}". */
  private relativePath(urlOrPath: string): string {
    const p = /^https?:/.test(urlOrPath) ? new URL(urlOrPath).pathname : urlOrPath.split('?')[0];
    const servers: Json[] = this.doc.servers ?? [];
    for (const s of servers) {
      const base = /^https?:/.test(s.url) ? new URL(s.url).pathname : s.url;
      if (base && base !== '/' && p.startsWith(base)) return p.slice(base.replace(/\/$/, '').length) || '/';
    }
    return p;
  }

  findOperation(method: string, urlOrPath: string): Op | undefined {
    const p = this.relativePath(urlOrPath);
    const candidates = this.ops.filter((o) => o.method === method.toUpperCase() && o.regex.test(p));
    // Prefer the most literal template (fewest parameters).
    return candidates.sort((a, b) => (a.template.match(/\{/g)?.length ?? 0) - (b.template.match(/\{/g)?.length ?? 0))[0];
  }

  check(r: Pick<RestResponse<unknown>, 'method' | 'url' | 'status' | 'headers' | 'data'>): ContractIssue[] {
    const op = this.findOperation(r.method, r.url);
    if (!op) return [{ path: '(operation)', message: `${r.method} ${this.relativePath(r.url)} is not in the OpenAPI document` }];
    this.hits.add(`${op.method} ${op.template}`);
    const responses: Json = op.operation.responses ?? {};
    const spec = responses[String(r.status)] ?? responses[`${String(r.status)[0]}XX`] ?? responses.default;
    if (!spec) return [{ path: '(status)', message: `status ${r.status} is not documented for ${op.method} ${op.template} (documented: ${Object.keys(responses).join(', ')})` }];
    const resolved = this.deref(spec);
    const content: Json = resolved.content ?? {};
    const ct = (r.headers['content-type'] ?? '').split(';')[0].trim();
    if (!Object.keys(content).length) return [];
    const media = content[ct] ?? content['application/json'] ?? Object.values(content)[0];
    if (!content[ct] && ct) return [{ path: '(content-type)', message: `content-type ${ct} is not documented (documented: ${Object.keys(content).join(', ')})` }];
    if (!media?.schema) return [];
    return this.validate(media.schema, r.data, '$');
  }

  assertConforms(r: Pick<RestResponse<unknown>, 'method' | 'url' | 'status' | 'headers' | 'data'>): void {
    const issues = this.check(r);
    if (issues.length) {
      throw new Error(`CONTRACT — ${r.method} ${r.url} (${r.status}) breaks the OpenAPI contract:\n` + issues.slice(0, 20).map((i) => `  - ${i.path}: ${i.message}`).join('\n'));
    }
  }

  /** Documented operations and whether this process exercised them. */
  coverage(): { operation: string; exercised: boolean }[] {
    return this.ops.map((o) => ({ operation: `${o.method} ${o.template}`, exercised: this.hits.has(`${o.method} ${o.template}`) }));
  }

  private deref(node: Json): Json {
    let n = node;
    let guard = 0;
    while (n && n.$ref && guard++ < 20) {
      const ref: string = n.$ref;
      if (!ref.startsWith('#/')) throw new Error(`External $ref not supported: ${ref}`);
      n = ref
        .slice(2)
        .split('/')
        .reduce<Json>((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], this.doc);
    }
    return n;
  }

  validate(schemaIn: Json, value: unknown, path: string): ContractIssue[] {
    const schema = this.deref(schemaIn);
    const issues: ContractIssue[] = [];
    if (!schema || typeof schema !== 'object') return issues;

    if (value === null) {
      const typeList = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (schema.nullable || typeList.includes('null')) return issues;
      if (schema.oneOf || schema.anyOf) {
        const alts: Json[] = schema.oneOf ?? schema.anyOf;
        if (alts.some((a) => this.validate(a, null, path).length === 0)) return issues;
      }
      if (schema.type || schema.properties) return [{ path, message: 'is null but not nullable' }];
      return issues;
    }
    if (schema.allOf) for (const s of schema.allOf as Json[]) issues.push(...this.validate(s, value, path));
    if (schema.oneOf || schema.anyOf) {
      const alts: Json[] = schema.oneOf ?? schema.anyOf;
      const passing = alts.filter((a) => this.validate(a, value, path).length === 0).length;
      if (schema.oneOf && passing !== 1) issues.push({ path, message: `matches ${passing} of the oneOf alternatives (needs exactly 1)` });
      if (schema.anyOf && passing === 0) issues.push({ path, message: 'matches none of the anyOf alternatives' });
    }
    const types: string[] = (Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []).filter((t: string) => t !== 'null');
    if (types.length && !types.some((t) => typeMatches(t, value))) {
      return [...issues, { path, message: `expected ${types.join('|')}, got ${Array.isArray(value) ? 'array' : typeof value}` }];
    }
    if (schema.enum && !schema.enum.includes(value)) issues.push({ path, message: `${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}` });
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, message: `shorter than ${schema.minLength}` });
      if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, message: `longer than ${schema.maxLength}` });
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) issues.push({ path, message: `does not match ${schema.pattern}` });
      if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) issues.push({ path, message: `"${value}" is not a date (yyyy-mm-dd)` });
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) issues.push({ path, message: `"${value}" is not a date-time` });
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, message: `below minimum ${schema.minimum}` });
      if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, message: `above maximum ${schema.maximum}` });
    }
    if (Array.isArray(value) && schema.items) {
      value.slice(0, 200).forEach((v, i) => issues.push(...this.validate(schema.items, v, `${path}[${i}]`)));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      for (const req of (schema.required as string[]) ?? []) {
        if (!(req in obj)) issues.push({ path: `${path}.${req}`, message: 'is required but missing' });
      }
      const props: Json = schema.properties ?? {};
      for (const [k, v] of Object.entries(obj)) {
        if (props[k]) issues.push(...this.validate(props[k], v, `${path}.${k}`));
        else if (schema.additionalProperties === false) issues.push({ path: `${path}.${k}`, message: 'is not allowed (additionalProperties: false)' });
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') issues.push(...this.validate(schema.additionalProperties, v, `${path}.${k}`));
      }
    }
    return issues;
  }
}

function typeMatches(t: string, v: unknown): boolean {
  switch (t) {
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'number':
      return typeof v === 'number';
    case 'string':
      return typeof v === 'string';
    case 'boolean':
      return typeof v === 'boolean';
    case 'array':
      return Array.isArray(v);
    case 'object':
      return typeof v === 'object' && v !== null && !Array.isArray(v);
    default:
      return true;
  }
}

/** Operations and schema properties added or removed between two OpenAPI documents. */
export function diffOpenApi(before: Json, after: Json): { added: string[]; removed: string[]; changed: string[] } {
  const flatten = (doc: Json) => {
    const out = new Map<string, string>();
    for (const [p, item] of Object.entries<Json>(doc.paths ?? {})) {
      for (const m of Object.keys(item)) {
        if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(m)) continue;
        out.set(`op ${m.toUpperCase()} ${p}`, Object.keys(item[m].responses ?? {}).sort().join(','));
      }
    }
    for (const [name, s] of Object.entries<Json>(doc.components?.schemas ?? {})) {
      for (const [prop, ps] of Object.entries<Json>(s.properties ?? {})) out.set(`schema ${name}.${prop}`, JSON.stringify(ps.type ?? ps.$ref ?? ''));
      out.set(`schema ${name} required`, JSON.stringify((s.required ?? []).slice().sort()));
    }
    return out;
  };
  const a = flatten(before);
  const b = flatten(after);
  return {
    added: [...b.keys()].filter((k) => !a.has(k)).sort(),
    removed: [...a.keys()].filter((k) => !b.has(k)).sort(),
    changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).map((k) => `${k}: ${a.get(k)} → ${b.get(k)}`).sort(),
  };
}
