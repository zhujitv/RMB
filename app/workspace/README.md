# NEXTWOOD React Workspace

This route is the React + TypeScript business workspace for NEXTWOOD.

- URL: `/workspace`
- Keeps the legacy `/index.html` + `/app.js` UI intact during the final parity window.
- Reuses existing Next.js API routes, Prisma, sessions, and permissions.
- Loads only authentication and menu permission data on entry.
- Shows a lightweight welcome page after login.
- Business data is loaded only after the user opens a module.

Available modules:

- 登录页 / 首次改密 / 账户设置
- 左侧导航和权限初始化
- 经营总览
- 应收订单
- 收款管理
- 成本管理
- 物流信息
- 利润分析
- 退税资料
- 报表中心
- 系统设置
- 操作说明书

Verification for migrated modules:

- `npm run typecheck`
- `npm run lint`
- `npm run build`

Production guardrails:

- Keep API, Prisma, session, permissions, and database structure unchanged.
- Compare high-frequency details against the legacy production UI before retiring old views.
- Keep 物流信息, 每票物流费用录入, 退税资料, 成本, 收款, and complex order fields aligned.

Domestic logistics parity note:

- The React `物流信息` module keeps the legacy per-order `录入费用` entry inside an order detail row.
- This is for single-order logistics fees such as trucking, customs, port charges, sea freight, and insurance.
- It is not a standalone left-sidebar `物流费用登记` module.
- Logistics supplier users have supplier selection locked by account.
- Admin users can select only logistics-related suppliers in the per-order logistics fee form.

Tax refund parity note:

- The React `退税资料` module keeps a compact list and opens details in a right-side drawer.
- Row details act as a compact task menu, not a full document-management page.
- Missing document chips open the detail drawer and jump to the corresponding upload or maintenance area.
- Finance/admin users can update tax refund status from the current list.
- Selecting `SUBMITTED / 已提交退税` uses the submit-and-archive confirmation flow and backend completeness validation.
