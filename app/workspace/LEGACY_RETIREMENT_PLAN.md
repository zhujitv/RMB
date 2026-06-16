# Legacy Frontend Retirement Plan

This document defines the safe retirement path for the legacy frontend:

- `/index.html`
- `/app.js`
- `/public/index.html`
- `/public/app.js`

The target state is:

- `/workspace` becomes the only business UI entry.
- Legacy HTML/JS no longer receives business feature changes.
- Legacy assets are removed only after traffic, routing, tests, and recovery paths are confirmed.

## Current Reality

As of this plan:

- React + TypeScript business modules have completed migration and acceptance.
- Production business work should use `/workspace`.
- Legacy frontend files still exist in the repo as a fallback and historical reference.
- Root routing has already been normalized to `/workspace`.
- Legacy-coupled tests have already been replaced with workspace-based checks.
- Build verification no longer depends on legacy `app.js`.
- The main remaining coupling is the shared root stylesheet import in `app/layout.jsx` and the legacy files themselves.

## Key Findings Before Retirement

1. `middleware.js` now redirects both `/` and `/index.html` to `/workspace`.
2. `app/page.jsx` now redirects `/` to `/workspace`.
3. `package.json` lint no longer checks legacy `app.js` files.
4. Tests have been rewritten to validate workspace React/API sources instead of legacy HTML/JS.
5. README and migration docs already describe React as the formal main entry.
6. Remaining repo references to legacy frontend are now primarily:
   - `README.md`
   - `app/workspace/README.md`
   - `app/workspace/MIGRATION_PLAN.md`
   - `app/layout.jsx` importing `../styles.css`
   - legacy file bodies in root and `public/`

This means the migration is functionally done and structurally much closer to retirement, but the repository is not yet ready to delete the legacy frontend files in one step.

## Retirement Principles

1. Do not delete legacy files in one step.
2. Normalize routing first.
3. Replace legacy-file-based tests before deleting legacy assets.
4. Keep one short rollback window.
5. Remove legacy references from build, lint, docs, and code together.

## Phase 1: Normalize Entry Routing

Status: Done

Goal:

- Make `/workspace` the only intended business entry.
- Remove ambiguous root-entry behavior.

Tasks:

1. Change `app/page.jsx` to redirect to `/workspace` instead of `/index.html`.
2. Keep `middleware.js` root redirect aligned with the same behavior.
3. Decide whether `/index.html` should:
   - temporarily redirect to `/workspace`, or
   - remain accessible only behind an explicit fallback path.

Recommended:

- `/` -> `/workspace`
- `/index.html` -> `/workspace`

Acceptance:

- Root path never lands on legacy UI.
- Direct open of `/index.html` no longer exposes the old business shell.

## Phase 2: Freeze Legacy Frontend

Status: In progress

Goal:

- Make it explicit that legacy UI is retired from business use before removal.

Tasks:

1. Stop all feature work on:
   - `index.html`
   - `app.js`
   - `public/index.html`
   - `public/app.js`
2. If temporary compatibility is still needed, replace legacy page content with a minimal redirect shell.
3. Remove legacy wording from docs that implies dual-primary UI.

Acceptance:

- Legacy files are no longer a functional business UI.
- React workspace is the only supported operator interface.

## Phase 3: Replace Legacy-Coupled Tests

Status: Done

Goal:

- Remove test dependence on legacy HTML/JS files.

Tasks:

1. Rewrite tests that read `app.js` / `index.html` directly.
2. Move parity checks to:
   - React component tests where practical, or
   - API/integration checks, or
   - simple text-presence assertions in React sources.
3. Update `npm run lint` so it no longer checks legacy JS files.

Completed replacements:

- `tests/domestic-logistics-layout.test.js`
- `tests/logistics-expense-workflow.test.js`
- `tests/preview-window.test.js`
- `tests/permission-hardening.test.js`

Acceptance:

- Test suite passes without reading legacy frontend files.

## Phase 4: Remove Legacy Build References

Status: Mostly done

Goal:

- Remove operational dependence on legacy artifacts.

Tasks:

1. Remove legacy file checks from `package.json` `lint`. Done.
2. Remove any legacy-only imports or runtime references.
3. Search and remove references to:
   - `/index.html`
   - `app.js`
   - `public/index.html`
   - `public/app.js`
4. Keep only historical documentation references where needed.

Acceptance:

- Build, lint, typecheck, and deploy complete without legacy frontend dependency.

## Phase 5: Delete Legacy Files

Status: Not started

Goal:

- Physically remove old frontend implementation.

Delete candidates:

- `/index.html`
- `/app.js`
- `/public/index.html`
- `/public/app.js`

Optional cleanup after deletion:

- remove duplicated legacy CSS blocks if no longer referenced
- remove legacy-only DOM helpers
- remove outdated README notes about fallback business usage

Acceptance:

- Repository no longer contains legacy business UI implementation.
- `/workspace` remains fully functional in production.

## Phase 6: Post-Retirement Verification

Must verify after deletion:

1. Login
2. Welcome page
3. Sidebar navigation
4. 应收订单
5. 收款管理
6. 成本管理
7. 物流信息
8. 利润分析
9. 退税资料
10. 报表中心
11. 系统设置
12. 文件上传 / 预览 / 下载
13. 权限隔离
14. Production routing:
    - `/`
    - `/workspace`
    - old `/index.html` path behavior

## Recommended Execution Order

1. Split shared stylesheet usage away from root `styles.css`
2. Remove legacy docs language that still implies active fallback usage
3. Replace legacy file bodies with minimal redirect shells if a short rollback window is desired
4. Delete legacy files
5. Deploy
6. Full manual acceptance

## Rollback Strategy

If a severe regression appears after retirement:

1. Revert the retirement commit
2. Redeploy production
3. Keep `/workspace` as primary entry
4. Reopen only the specific compatibility path needed for diagnosis

## Completion Definition

Legacy retirement is complete only when all of the following are true:

- `/workspace` is the sole business UI
- root routing is unified
- no tests depend on legacy HTML/JS
- no build scripts depend on legacy HTML/JS
- legacy files are removed from repo
- production manual verification passes
