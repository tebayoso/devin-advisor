# Devin MCP Marketplace — Submission Prep

This document collects the metadata and readiness checklist for a potential listing of `devin-scope`
on the Devin MCP Marketplace. Per [`PRD.md`](PRD.md) §12, an official Marketplace listing is a
post-MVP goal to pursue *if/when* submissions open. Nothing here changes runtime behavior; it exists
so a submission can be assembled quickly and accurately.

> Status: **prep only.** Confirm the exact fields and process against the official Devin Marketplace
> submission guidelines before submitting, since requirements may change.

## Proposed listing metadata

| Field | Value |
| --- | --- |
| Name | devin-scope |
| Tagline | Turn ambiguous tasks into adversarially reviewed execution plans. |
| Category | Planning / Task decomposition |
| Transport | HTTP / Streamable HTTP |
| Endpoint | `https://devin-scope.<your-subdomain>.workers.dev/mcp` |
| Health check | `GET /health` → `ok` |
| Auth | None (single-org / trusted use); auth is a future extension |
| Server name (MCP `initialize`) | `devin-scope` |
| Protocol version | `2024-11-05` |
| Version | `0.1.0` (see [`mcp/package.json`](../mcp/package.json)) |
| Repository | https://github.com/tebayoso/devin-advisor |
| License | [MIT](../LICENSE) |
| Maintainer | tebayoso |
| Support | GitHub issues on the repository |

### Exposed tools

| Tool | Purpose |
| --- | --- |
| `get_scope_instructions` | Serve the full planning workflow the agent must follow. |
| `decompose_task` | Break an ambiguous task into 3–7 subtasks with confidence scores. |
| `run_adversarial_review` | Structured critique: weak assumptions, missing edge cases, risks. |
| `save_plan` / `get_plan` | Persist and retrieve plans. |
| `save_memory` / `query_memory` | Cross-session key/value memory scoped by workspace. |
| `get_verification_checklist` | Self-verification checklist to satisfy before proposing a PR. |

The authoritative tool schemas are the `inputSchema` definitions in
[`mcp/src/tools.ts`](../mcp/src/tools.ts); keep this table in sync with them.

### Suggested description (for the listing body)

> devin-scope is a Cloud-first planning harness for Devin. It forces underspecified engineering tasks
> through a disciplined pipeline — decompose → persist → mandatory adversarial review → verification —
> and keeps plans and learnings in shared cross-session memory. Delivered as a remote MCP server
> (Cloudflare Workers + D1) plus a minimal Playbook and a native Skill.

## Prerequisites (must be true before submitting)

- [ ] Server is deployed and reachable at a stable HTTPS `/mcp` endpoint.
- [ ] `GET /health` returns `ok`.
- [ ] `initialize`, `tools/list`, and `tools/call` all behave per the MCP spec (`2024-11-05`).
- [ ] Cloudflare D1 database is created and `schema.sql` has been applied.
- [ ] No secrets are committed; `wrangler.toml` contains only a placeholder `database_id`.
- [ ] Public repository with a clear README, license, and usage examples.
- [ ] CI is green on `main` (`typecheck`).
- [ ] A version tag / release exists that matches the `version` reported by `initialize`.

## Submission checklist

- [ ] Confirm the current official Marketplace submission process and required fields.
- [ ] Fill in the concrete production `/mcp` URL (replace the `<your-subdomain>` placeholder).
- [ ] Provide the listing metadata from the table above.
- [ ] Attach or link the tool list with descriptions and input schemas.
- [ ] Provide setup instructions (link to [`../README.md`](../README.md) Quick start).
- [ ] Provide troubleshooting/FAQ (link to [`troubleshooting.md`](troubleshooting.md)).
- [ ] State the auth model explicitly (currently unauthenticated / single-org).
- [ ] State data handling: plans/reviews/memory stored in the operator's own Cloudflare D1.
- [ ] Include a short demo (link to [`../examples/demo-script.md`](../examples/demo-script.md)).
- [ ] Add screenshots or a recording of the pipeline running in a Devin Cloud session (optional but
      recommended).
- [ ] Verify all links in the listing resolve.

## Post-submission maintenance

- Bump `version` in [`mcp/package.json`](../mcp/package.json) and the `initialize` response together;
  keep this doc's metadata table current.
- Re-run `npm run deploy` after changes; apply schema migrations with `npm run db:init`.
- Keep the tools table and schemas in [`mcp/src/tools.ts`](../mcp/src/tools.ts) aligned with the
  listing.
