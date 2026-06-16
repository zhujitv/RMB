# React + TypeScript Workspace Status

The `/workspace` route is the production React + TypeScript workspace. The legacy UI has been reduced to a redirect shell, and daily business work must use the React modules.

## Current Foundation

- `/workspace` route
- Authentication screens
- First-login password change
- Permission-aware sidebar
- Permission fallback that redirects unavailable modules back to the workspace home
- Account settings and password change screens
- Welcome page with no business data preload
- React server-paged receivable orders list with customer autocomplete, full order create/edit, payment terms, installment nodes, default logistics supplier rules, detail view, and soft-delete actions, loaded only after opening 应收订单
- React server-paged payments list with create, edit, confirm-arrival, and delete actions, loaded only after opening 收款管理
- React paged costs list with current/archive/all business scope, create, manual-cost edit, and delete actions, loaded only after opening 成本管理
- React domestic logistics list, expanded keyword search, inline edit form, multi-container transport items, customs document upload/delete panel, and per-order logistics fee entry, loaded only after opening 物流信息
- React paged profit analysis list and commission settlement action, loaded only after opening 利润分析
- React paged tax refund current/archive lists, compact task menu, missing-document jump chips, on-demand detail drawer, tax status update, customs declaration manual fields, export/customs/factory/logistics document upload/delete, package download, submit-to-archive, and cancel-archive actions, loaded only after opening 退税资料
- React report query shell with full business filters, tabs, pagination, row selection, detail rows, and Excel/CSV on-demand export scopes
- React settings shell with customer, supplier, user, custom-permission matrix, and exchange-rate edit, plus audit-log tabs loaded on demand
- React operation manual page with search, table of contents, process cards, and expandable sections
- React dashboard with month/search filters, core metric cards, 12-month trend, risk alerts, profit analysis, cost structure, and salesperson performance loaded on demand
- Shared detail field, pagination, legacy action, and finance/date formatter helpers
- Shared API client, menu registry, utility functions, and production workspace helpers

## Module Acceptance Checklist

Each migrated module must keep the legacy behavior before the old view is retired.

- Uses existing API routes unless a backend change is explicitly required.
- Does not trust frontend-calculated finance amounts.
- Keeps backend permission checks.
- Keeps pagination defaults at 20 rows for lists.
- Handles 401, 403, timeout, and business validation errors separately.
- Does not expose database IDs in user-facing UI.
- Preserves upload, preview, download, and delete permissions where applicable.
- Passes `npm run typecheck`, `npm run lint`, and `npm run build`.

## Migration Order

1. 应收订单 - ready / accepted
2. 收款管理 - ready / accepted
3. 成本管理 - ready / accepted
4. 物流信息 - ready / accepted
5. 退税资料 - ready / accepted
6. 报表中心 - ready / accepted
7. 系统设置 - ready / accepted

## Current Parity Guardrails

- 物流信息: keep legacy per-order fee entry, logistics supplier lock, customs documents, and multi-container transport details aligned with the online legacy UI.
- 退税资料: keep the list compact, use the detail drawer for full file management, preserve tax status updates, submit-to-archive validation, missing-document jump chips, and manual shipping-document sending.
- Legacy production behavior remains the parity reference, but not the runtime entry.

## Legacy Frontend Policy

- `index.html` is retained only as a redirect shell into `/workspace`.
- Legacy business UI code is being retired and must not receive feature work.
- New workflows and all ongoing business fixes belong in React + TypeScript.
- Old frontend files can be physically deleted once the final compatibility window closes.
