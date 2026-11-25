import Link from "next/link";
import { openApiDocument } from "@/server/openapi";

export const metadata = { title: "API reference" };

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: unknown[]; description?: string; anyOf?: Schema[]; nullable?: boolean };
type Op = { summary: string; description?: string; tags: string[]; parameters?: { name: string; in: string; description?: string; schema: Schema }[]; requestBody?: { content: { "application/json": { schema: Schema } } }; responses: Record<string, { description: string }> };

const typeOf = (s: Schema): string =>
  s.enum ? s.enum.map((v) => JSON.stringify(v)).join(" | ") : s.anyOf ? s.anyOf.map(typeOf).join(" | ") : s.type === "array" ? `${typeOf(s.items ?? {})}[]` : Array.isArray(s.type) ? s.type.join(" | ") : s.type ?? "object";

function Fields({ schema }: { schema: Schema }) {
  const props = Object.entries(schema.properties ?? {});
  if (!props.length) return null;
  return (
    <table className="mt-2 w-full text-left text-xs">
      <tbody className="divide-y divide-border">
        {props.map(([name, p]) => (
          <tr key={name} className="align-top">
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{name}{schema.required?.includes(name) ? <span className="text-danger">*</span> : null}</td>
            <td className="py-1.5 pr-3 font-mono text-muted-foreground">{typeOf(p)}</td>
            <td className="py-1.5 text-muted-foreground">{p.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const METHOD_CLS: Record<string, string> = { get: "bg-info/15 text-info", post: "bg-success/15 text-success", put: "bg-primary/15 text-primary", patch: "bg-warning/15 text-warning", delete: "bg-danger/15 text-danger" };

/** Human-readable API reference, rendered from the same OpenAPI document the API serves. */
export default function ApiDocsPage() {
  const doc = openApiDocument("");
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods as Record<string, Op>).map(([method, op]) => ({ path, method, op })));
  const tags = [...new Set(ops.map((o) => o.op.tags[0]))];
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/workspace/integrations" className="text-sm text-muted-foreground hover:text-foreground">← Integrations</Link>
      <h1 className="mt-3 text-3xl font-semibold">Platform API</h1>
      <p className="mt-2 text-muted-foreground">{doc.info.description}</p>
      <div className="mt-6 grid gap-3 rounded-2xl border bg-card p-5 text-sm">
        <p><span className="font-medium">Base URL:</span> <code>/api/v1</code> on this host · <span className="font-medium">Auth:</span> <code>Authorization: Bearer &lt;api key&gt;</code> (keys from Workspace → Integrations; read-only keys can only GET)</p>
        <p><span className="font-medium">Errors:</span> <code>{"{ error: { type, code, message, param?, requestId } }"}</code>. <code>code</code> is stable and documented; every response carries <code>X-Request-Id</code>.</p>
        <p><span className="font-medium">Lists:</span> <code>{"{ object: \"list\", data, nextCursor }"}</code>; pass <code>cursor=nextCursor</code> for the next page (limit ≤ 200). Sync with <code>updatedSince</code>.</p>
        <p><span className="font-medium">Idempotency:</span> natural keys. Re-posting a conversation with an existing <code>externalId</code> returns it with <code>200</code> and <code>Idempotent-Replayed: true</code>.</p>
        <p><span className="font-medium">Rate limits:</span> 600 requests/minute per key; <code>429</code> with <code>Retry-After</code> and <code>RateLimit-*</code> headers.</p>
        <p><span className="font-medium">Webhooks:</span> <code>conversation.completed</code>, <code>conversation.failed</code>, <code>conversation.updated</code>, signed per <a className="underline" href="https://www.standardwebhooks.com">Standard Webhooks</a>; retried with backoff for ~2 h; reconcile with <code>updatedSince</code>.</p>
        <p><a className="underline" href="/api/v1/openapi.json">OpenAPI 3.1 JSON</a> (generated from the same schemas that validate requests).</p>
      </div>
      {tags.map((tag) => (
        <section key={tag} className="mt-10">
          <h2 className="text-xl font-semibold">{tag}</h2>
          <div className="mt-3 space-y-4">
            {ops.filter((o) => o.op.tags[0] === tag).map(({ path, method, op }) => {
              const body = op.requestBody?.content["application/json"].schema;
              const query = op.parameters?.filter((p) => p.in === "query") ?? [];
              return (
                <article key={method + path} id={`${method}-${path}`} className="rounded-2xl border bg-card p-5">
                  <h3 className="flex flex-wrap items-center gap-2 font-mono text-sm">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${METHOD_CLS[method]}`}>{method}</span>{path}
                  </h3>
                  <p className="mt-2 font-medium">{op.summary}</p>
                  {op.description && <p className="mt-1 text-sm text-muted-foreground">{op.description}</p>}
                  {query.length > 0 && (<><p className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Query</p><Fields schema={{ properties: Object.fromEntries(query.map((q) => [q.name, { ...q.schema, description: q.description ?? q.schema.description }])) }} /></>)}
                  {body && (<><p className="mt-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Body</p><Fields schema={body} /></>)}
                  <p className="mt-3 text-xs text-muted-foreground">Responses: {Object.entries(op.responses).filter(([s]) => s !== "default").map(([s, r]) => `${s} ${r.description}`).join(" · ")}</p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
