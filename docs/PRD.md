# Product Requirements Document (PRD)
# Project: devin-scope

**Version:** 0.2 (Detailed MVP)
**Date:** July 18, 2026
**Author:** Team
**Status:** Ready for implementation
**Target Build Time:** 90 minutes
**Primary Goal:** Closest-to-1-click Task Decomposition + Adversarial Review system that works fully inside Devin Cloud agents.

---

## 1. Product Vision

`devin-scope` is an open-source system that gives any Devin Cloud agent the ability to turn ambiguous engineering tasks into high-confidence, adversarially reviewed execution plans.

It combines:
- Structured task decomposition with confidence scoring
- Mandatory adversarial review (edge cases, risks, weak assumptions)
- Persistent cross-session memory
- Self-verification checklists
- Tight integration with Devin's native ecosystem (MCP, Playbooks, Skills, official Devin MCP)

The system is designed so that after a one-time configuration (add remote MCP + optionally attach Playbook or connect the repo), any Cloud agent can run the full workflow by simply receiving a prompt like "Scope this task: …".

---

## 2. Problem Statement

Historical and current user feedback around Devin consistently highlights these pain points:

- Tasks are frequently underspecified.
- Agents dive into coding too early without proper scoping.
- Lack of systematic adversarial thinking leads to missing edge cases.
- No persistent memory of previous plans and their critiques across sessions.
- Difficulty coordinating multi-agent / managed Devin workflows with clear confidence levels.

`devin-scope` directly attacks these problems by forcing a rigorous, memory-backed planning phase before any significant coding begins.

---

## 3. Goals & Non-Goals

### Goals (MVP)
- Work 100% inside Devin Cloud agents (remote VMs).
- Require the absolute minimum configuration possible.
- Provide high-quality adversarial reviews.
- Persist plans and reviews in shared memory (Cloudflare D1).
- Be fully open source and easily tryable by anyone.
- Leverage official Devin MCP tools when useful (session creation, knowledge, etc.).

### Non-Goals (MVP)
- Full authentication / multi-tenancy / per-user isolation.
- Spawning real adversarial Devin sessions via API in the first version (Modo B).
- Local stdio transport as primary path.
- Official Devin Marketplace listing (can be pursued later).
- Complex UI or dashboard.

---

## 4. Target Users

1. Individual engineers using Devin Cloud who want better planning.
2. Teams that want standardized scoping + adversarial review.
3. Cognition / Deployed Engineers who can recommend or demo the system.
4. Anyone who wants to try a production-grade planning harness on top of Devin.

---

## 5. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Devin Cloud Agent                        │
│  (receives user prompt + optional Playbook / Skill)          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              Playbook "devin-scope" (minimal)                │
│  Forces agent to call get_scope_instructions first           │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│         Remote MCP Server (Cloudflare Workers)               │
│  Transport: Streamable HTTP                                   │
│  Endpoint: https://devin-scope.<your-subdomain>.workers.dev/mcp
│                                                              │
│  Tools:                                                      │
│  - get_scope_instructions                                    │
│  - decompose_task                                            │
│  - run_adversarial_review                                    │
│  - save_plan / get_plan                                      │
│  - query_memory / save_memory                                │
│  - get_verification_checklist                                │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare D1 (SQLite)                     │
│  Tables: plans, reviews, memory                              │
└─────────────────────────────────────────────────────────────┘
```

Optional secondary path:
- Official Devin MCP (`https://mcp.devin.ai/mcp`) can be used by the agent (when configured) to create managed sessions, update Knowledge, etc.

---

## 6. Detailed Component Specifications

### 6.1 Remote MCP Server

**Technology Stack**
- Runtime: Cloudflare Workers
- Language: TypeScript
- MCP SDK: `@modelcontextprotocol/sdk` + Cloudflare Agents helpers (`createMcpHandler` or equivalent)
- Database: Cloudflare D1
- Transport: Streamable HTTP only (primary). stdio is out of scope for MVP.

**Endpoint**

```
POST https://devin-scope.<subdomain>.workers.dev/mcp
```

**Authentication (MVP)**
- Public (no auth) for easy demo.
- Optional future: simple Bearer token via header.

### 6.2 Tools Specification

#### Tool 1: `get_scope_instructions`
- **Purpose**: Serve the full planning Skill content so the agent does not need the Skill file present in the repo.
- **Input**: none (or optional `version`)
- **Output**: Full markdown instructions that the agent must follow strictly.
- **Behavior**: Returns a carefully engineered prompt that forces the complete workflow (decompose → adversarial → save → verification).

#### Tool 2: `decompose_task`
- **Input**:
  - `task` (string, required) – the original ambiguous task
  - `context` (string, optional) – extra context (repo, constraints, etc.)
  - `workspace` (string, optional) – for memory scoping
- **Output**: Structured JSON containing:
  - List of subtasks
  - Confidence per subtask (`high` | `medium` | `low`)
  - Justification
  - Suggested execution strategy (parallel / sequential / managed Devins)
  - Estimated complexity

#### Tool 3: `run_adversarial_review`
- **Input**:
  - `plan_id` or full decomposition object
  - `original_task`
- **Output**: Structured adversarial critique containing:
  - List of weak assumptions
  - Missing edge cases
  - Risk scores
  - Recommended changes to the plan
  - Overall confidence adjustment

#### Tool 4: `save_plan`
- Saves the full plan + adversarial review into D1.
- Returns a `plan_id`.

#### Tool 5: `get_plan`
- Retrieves a previously saved plan by `plan_id`.

#### Tool 6: `query_memory` / `save_memory`
- Simple key-value + tag based memory scoped by workspace/project.
- Used to store learnings, recurring patterns, and past adversarial insights.

#### Tool 7: `get_verification_checklist`
- Generates a concrete checklist the agent must complete before proposing any PR.

### 6.3 Database Schema (Cloudflare D1)

```sql
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  workspace TEXT,
  original_task TEXT NOT NULL,
  decomposition JSON NOT NULL,
  confidence_summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  critique JSON NOT NULL,
  risks JSON,
  missing_cases JSON,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE memory (
  id TEXT PRIMARY KEY,
  workspace TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL
);
```

---

## 7. Integration with Devin Ecosystem

### 7.1 Official Devin MCP (https://mcp.devin.ai/mcp)
The agent is encouraged (via the instructions returned by `get_scope_instructions`) to also use the official Devin MCP when available for:

- Creating managed Devin sessions (`devin_session_create`)
- Gathering results from parallel sessions (`devin_session_gather`)
- Updating Knowledge (`devin_knowledge_manage`)
- Managing Playbooks

This creates a powerful hybrid: `devin-scope` handles planning + adversarial rigor, while the official Devin MCP handles execution orchestration.

### 7.2 Playbook (Primary Distribution Method)
A short Playbook named `devin-scope` will be provided.
Content (conceptual):

```
You are required to use the devin-scope MCP for any planning, scoping, or decomposition request.

Mandatory first step:
1. Call the tool `get_scope_instructions` from the devin-scope MCP.
2. Follow the returned instructions exactly and completely.
3. Do not invent your own decomposition process.
4. Always run the adversarial review before finalizing any plan.
5. Persist the final plan using the MCP tools.
```

Users attach this Playbook when starting a session (1 click).

### 7.3 Skill (Secondary / Power User Path)
The same instructions will also live as a native Skill in the repository under:

```
.agents/skills/scope/SKILL.md
```

This allows automatic discovery when the repo is connected to the organization.

---

## 8. User Flows

### Flow A – Minimum Friction (Recommended for Demo)
1. Admin adds the remote MCP URL once in Devin Settings.
2. User starts a new Cloud session and attaches the `devin-scope` Playbook.
3. User writes: "Scope this task: Implement rate limiting for the public API"
4. Agent automatically follows the full pipeline.

### Flow B – Repo Connected
1. User connects the `devin-scope` GitHub repo to their Devin organization.
2. Skill becomes available via indexing.
3. User can invoke `/scope` or natural language.

---

## 9. Technical Constraints & Decisions
- **Primary transport**: Streamable HTTP (required for Cloud agents).
- **No local stdio** in the critical path.
- **Memory must be remote** (D1) so different Cloud sessions can share history.
- **Adversarial review in MVP** is performed by the same Devin agent using a strong structured prompt returned by the tool (Modo A). Spawning a separate critic session is deferred.
- All tools must return clean, structured JSON whenever possible so the agent can reason over it reliably.

---

## 10. Success Metrics for MVP
- Configuration time for a new user < 3 minutes.
- Full pipeline (decompose → adversarial → save → checklist) completes successfully in a real Devin Cloud session.
- Adversarial review produces at least 3 concrete, actionable critiques on average.
- Plan and review are retrievable from a second independent session.
- Public repository with clear README exists and is usable by third parties.

---

## 11. Implementation Plan (90 minutes)

| Time Slot | Task | Owner |
| --- | --- | --- |
| 0–12 min | Repo scaffold + Cloudflare Worker + D1 | - |
| 12–40 min | Implement all core tools + DB layer | - |
| 40–55 min | Write high-quality `get_scope_instructions` content | - |
| 55–65 min | Create minimal Playbook + Skill file | - |
| 65–80 min | README, examples, deploy | - |
| 80–90 min | End-to-end test in real Devin Cloud session | - |

---

## 12. Future Extensions (Post-MVP)
- Authenticated multi-tenant mode
- True adversarial sessions via Devin API (spawn cheap critic Devin)
- Automatic promotion of high-quality plans into Knowledge / Playbooks
- Cost/confidence routing suggestions
- Integration with Linear / Jira for ticket-driven scoping
- Submission to Devin MCP Marketplace (if/when open)

---

## 13. Open Questions
1. Should the public demo MCP be completely unauthenticated or use a simple shared token?
2. Do we want to support workspace isolation from day one?
3. How aggressively should the instructions force the agent to also use the official Devin MCP?

---

## 14. Appendix – Key Devin References
- Official Devin MCP: https://mcp.devin.ai/mcp
- Custom MCP addition: Settings → Connections → MCP servers → Add a custom MCP (HTTP / Streamable HTTP)
- Skill discovery paths: `.agents/skills/`, `.devin/skills/`, etc.
- Playbooks: Managed in the Devin web app, attachable per session
- Cloud agents run in isolated VMs and can only reach remote HTTP MCPs reliably

*End of PRD*
