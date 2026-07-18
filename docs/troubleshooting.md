# Troubleshooting & FAQ

Practical answers for setting up and running `devin-scope`. If something here does not match what
you see, please open an issue.

## Troubleshooting

### The MCP server does not appear / tools are not listed in Devin
- Confirm the URL ends in `/mcp` (e.g. `https://devin-scope.<your-subdomain>.workers.dev/mcp`) and
  the transport type is **HTTP / Streamable HTTP**, not SSE or stdio.
- Verify the Worker is live: `curl https://devin-scope.<your-subdomain>.workers.dev/health` should
  return `ok`.
- Send a manual `tools/list` request to confirm the server responds (see [Verify the deployment](#verify-the-deployment)).

### `wrangler deploy` fails with a D1 / `database_id` error
- You must create the database and paste its id into `mcp/wrangler.toml` before deploying:
  ```bash
  cd mcp
  wrangler d1 create devin_scope    # copy the returned database_id
  ```
  Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` in `wrangler.toml` with that value.
- The `database_id` is **not** a secret, but it is account-specific — do not commit someone else's id.

### Tool calls fail with "no such table: plans" (or `memory`)
- The schema was never applied to the D1 database. Run:
  ```bash
  cd mcp
  npm run db:init            # applies schema.sql to the remote D1 database
  ```
- For local development against a local D1, apply the schema with `--local`:
  ```bash
  wrangler d1 execute devin_scope --local --file=./schema.sql
  ```

### `npm run dev` starts but `POST /mcp` returns 404 / 405
- Only `POST /mcp` and `GET /health` are served. `GET /mcp` returns 405; any other path returns 404.
- Send a JSON-RPC 2.0 body over `POST`, for example:
  ```bash
  curl -s http://localhost:8787/mcp \
    -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```

### `npm run typecheck` fails after a fresh clone
- Run `npm install` inside `mcp/` first — the check depends on `@cloudflare/workers-types` and the
  pinned `typescript` version.

### Cross-session memory returns nothing in a second session
- Memory is scoped by `workspace`. If one session saved with a `workspace` value and another queries
  with a different (or empty) one, results will not match. Use a consistent `workspace` id, or omit it
  in both places.
- `query_memory` uses a substring (`LIKE`) match over key/value/tags — try broader terms.

## Verify the deployment

```bash
# Health check
curl https://devin-scope.<your-subdomain>.workers.dev/health      # -> ok

# List tools over MCP (JSON-RPC 2.0)
curl -s https://devin-scope.<your-subdomain>.workers.dev/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .
```

## FAQ

**Do I need to run anything locally to use devin-scope?**
No. Once the Worker is deployed and the MCP URL is added in Devin, everything runs inside Devin Cloud
agents. Local development is only needed to modify the server.

**Does it cost money to run?**
It runs on Cloudflare Workers + D1, which have generous free tiers. Typical scoping usage stays well
within them. You are responsible for your own Cloudflare account and usage.

**Is any authentication required?**
No — the MVP server is unauthenticated and intended for trusted, single-org use. Authenticated,
multi-tenant mode is a documented future extension (see [`PRD.md`](PRD.md) §12). Do not expose a
sensitive deployment publicly without adding your own access controls.

**Playbook or Skill — which should I use?**
The Playbook is the primary distribution and works without connecting the repo. The Skill is
auto-discovered when the repo is connected to your Devin org. You can use either; both drive the same
MCP workflow.

**How "smart" are `decompose_task` and `run_adversarial_review` today?**
In the current scaffold they return deterministic, structured skeletons so the end-to-end pipeline and
persistence work reliably. Model-backed generation is tracked in the roadmap (`phase:improvements`).
The agent still performs the substantive reasoning around these tools.

**Where is data stored?**
Plans, reviews, and memory are stored in your own Cloudflare D1 database (see
[`../mcp/schema.sql`](../mcp/schema.sql)). Nothing is sent to a third-party service.

**Can I self-host without Cloudflare?**
The server targets the Cloudflare Workers runtime and the D1 binding, so Cloudflare is the supported
path. Porting to another runtime would require replacing the D1 layer in `mcp/src/db.ts`.

**How do I update the deployed server after changing code?**
Re-run `npm run deploy` from `mcp/`. If you changed `schema.sql`, apply the migration with
`npm run db:init` (or a targeted `wrangler d1 execute`).
