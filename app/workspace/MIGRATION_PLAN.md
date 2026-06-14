# React + TypeScript Module Migration Plan

The new workspace keeps the legacy UI intact while modules move one by one.

## Current Foundation

- `/workspace` route
- Authentication screens
- First-login password change
- Permission-aware sidebar
- Permission fallback that redirects unavailable modules back to the workspace home
- Account settings and password change screens
- Welcome page with no business data preload
- React receivable orders list with quick-create, basic edit, and soft-delete actions, loaded only after opening 应收订单
- React server-paged payments list with create, edit, confirm-arrival, and delete actions, loaded only after opening 收款管理
- React paged costs list with create, manual-cost edit, and delete actions, loaded only after opening 成本管理
- React domestic logistics list, inline edit form, multi-container transport items, customs document upload/delete panel, and per-order logistics fee entry, loaded only after opening 国内物流信息
- React paged profit analysis list and commission settlement action, loaded only after opening 利润分析
- React paged tax refund current/archive lists, compact task menu, missing-document jump chips, on-demand detail drawer, tax status update, customs declaration manual fields, export/customs/factory/logistics document upload/delete, package download, submit-to-archive, and cancel-archive actions, loaded only after opening 退税资料
- React report query shell with full business filters, tabs, pagination, row selection, detail rows, and Excel/CSV on-demand export scopes
- React settings shell with customer, supplier, user, custom-permission matrix, and exchange-rate edit, plus audit-log tabs loaded on demand
- React operation manual page with search, table of contents, process cards, and expandable sections
- React dashboard shell with month/search filters, core business metric cards, monthly trend, and risk reminders loaded on demand
- Shared detail field, pagination, legacy action, and finance/date formatter helpers
- Shared API client, menu registry, utility functions, and migration descriptors

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

1. 应收订单
2. 收款管理
3. 成本管理
4. 国内物流信息
5. 退税资料
6. 报表中心
7. 系统设置

## Current Parity Focus

- 国内物流信息: keep legacy per-order fee entry, logistics supplier lock, customs documents, and multi-container transport details aligned with the online legacy UI.
- 退税资料: keep the list compact, use the detail drawer for full file management, preserve tax status updates, submit-to-archive validation, missing-document jump chips, and manual shipping-document sending.
- Legacy frontend remains the reference for final parity checks before disabling old views.

## Legacy Frontend Policy

- `index.html` and `app.js` remain available during migration.
- Only bug fixes should be made in the legacy frontend.
- New complex workflows should be built in React + TypeScript.
- A legacy module can be retired only after parity is verified in production-like data.
