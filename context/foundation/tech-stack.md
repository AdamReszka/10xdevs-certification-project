---
starter_id: next
package_manager: npm
project_name: sprintflow
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: true
---

## Why this stack

SprintFlow is a complex anomaly-detection dashboard built solo in four after-hours weeks, which makes maximum agent-friendliness the top priority at stack selection time. Next.js is the lead because it clears all four quality gates and carries the highest TypeScript training-data density in the JS family — every App Router pattern, server-action shape, and route-handler question has an authoritative answer immediately available. Its deployment defaults explicitly include Cloudflare Pages as a supported target via the @cloudflare/next-on-pages adapter. Auth (NextAuth / Better Auth) and PostgreSQL (Drizzle + Neon or Supabase) are high-coverage additions that cover FR-001 without coupling the project to a pre-bundled SaaS starter; the 15-minute background sync requirement (FR-011, FR-012) maps cleanly to node-cron on a long-running process or Cloudflare Cron Triggers. The Refinement Helper's LLM calls (FR-020) run natively via the Anthropic SDK in Node.js. Custom path was taken to surface the full candidate set; all five self-check points confirmed; no quality override was needed.
