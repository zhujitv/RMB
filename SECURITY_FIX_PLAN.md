# 安全修复计划

## 修复原则

- 不先追求大重构，优先堵住可导致财务错误、越权查看、导出风险和审计缺失的问题。
- 所有权限必须以后端为准，前端隐藏按钮只作为体验优化。
- 所有财务关键动作必须留下可追溯日志。
- 主业务数据不做物理删除，只允许软删除、作废、停用、归档。

## 2026-06-08 修复进展

已完成第一批高优先级加固：

- 成本录入员不能自行确认普通成本，且不能继续修改已确认成本。
- CSV 导出已增加公式注入转义。
- 成本录入员应收订单搜索改为必须输入关键词，并返回脱敏字段。
- 物流资料录入员默认只显示自己录入过的物流信息订单；新增录入必须通过订单号或提单号搜索匹配。
- 新增收款不能直接保存为“已到账/部分到账”；由非录入人的财务或管理员复核确认。

后续仍建议继续补齐独立复核字段、确认人字段、导出日志和操作原因字段。

## P0：立即修复

### 1. 成本确认权限拆分

- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3980)
  - `/api/costs`
- 修改方案：
  - `saveCost()` 中对成本录入员强制忽略 `costConfirmed=true`。
  - 新增或复用独立确认接口，仅管理员、财务可确认。
  - 录入人与确认人不能为同一人。
- 验收：
  - 成本录入员无法自己确认成本。
  - 财务确认后记录确认人、确认时间、操作日志。

### 2. CSV 公式注入防护

- 涉及文件：
  - [lib/report-service.js](/Volumes/工作/外贸收款/lib/report-service.js:343)
- 修改方案：
  - `csvCell()` 对 `= + - @` 开头字段前置 `'`。
  - 对所有导出报表生效。
- 验收：
  - 导出含公式前缀的客户名、供应商名、备注时，Excel 不执行公式。

### 3. 收窄成本录入员应收搜索权限

- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3181)
  - `/api/receivables/search`
- 修改方案：
  - 删除 `OWN_COST` 下的 `{}` 全量搜索。
  - 如确需成本员选订单，返回脱敏字段或建立订单授权表。
- 验收：
  - 成本录入员不能通过搜索枚举所有订单金额和客户信息。

### 4. 收窄物流资料录入员订单范围

- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3092)
  - `/api/domestic-logistics`
- 修改方案：
  - 新增订单级物流资料授权。
  - `LOGISTICS_OPERATOR` 只能查看被授权订单。
- 验收：
  - 未授权订单不出现在列表。
  - 手工访问未授权订单接口返回 403。

### 5. 收款到账确认复核

- 涉及文件：
  - `/api/payments`
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:406)
- 修改方案：
  - 新增 `confirmedById`、`confirmedAt`、`confirmRemark`。
  - 录入和确认拆分。
  - 录入人不得确认自己录入的收款。
- 验收：
  - 新增收款默认待确认。
  - 只有复核人确认后才计入已到账。

### 6. 导出和下载审计日志

- 涉及文件：
  - [lib/report-service.js](/Volumes/工作/外贸收款/lib/report-service.js:396)
  - `/api/order-documents/{id}/download`
  - `/api/tax-refunds/package`
- 修改方案：
  - 导出、下载、预览、资料包下载全部写 AuditLog。
  - AuditLog 增加 `userAgent`、`result`、`reason`。
- 验收：
  - 可追踪谁导出了什么、下载了什么、何时何 IP。

### 7. 删除/作废必须填写原因

- 涉及 API：
  - `/api/orders/{id}`
  - `/api/payments/{id}`
  - `/api/costs/{id}`
  - `/api/order-documents/{id}`
- 修改方案：
  - DELETE 请求体必须包含 `reason`。
  - 写入 AuditLog。
- 验收：
  - 未填写原因返回 400。

### 8. 修正 Vercel build 脚本

- 涉及文件：
  - [package.json](/Volumes/工作/外贸收款/package.json:5)
- 修改方案：
  - `build` 改为 `prisma generate && next build`。
  - 保留 `db:deploy` 独立执行迁移。
- 验收：
  - Vercel 构建不会自动迁移生产数据库。

### 9. 增加安全响应头

- 涉及文件：
  - [next.config.mjs](/Volumes/工作/外贸收款/next.config.mjs:1)
- 修改方案：
  - 增加 CSP、frame-ancestors、Referrer-Policy、Permissions-Policy、X-Content-Type-Options。
- 验收：
  - 线上响应头通过浏览器网络面板可见。

### 10. 登录失败锁定与密码复杂度

- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:163)
  - `/api/auth/login`
  - `/api/auth/change-password`
- 修改方案：
  - 5 次失败锁定 30 分钟。
  - 密码至少 8 位且包含字母和数字。
- 验收：
  - 连续失败登录被锁定。
  - 弱密码不能保存。

## P1：7 天内修复

1. 数据库唯一性约束：`ReceivableOrder.orderNo`、规范化客户名、规范化供应商名。
2. 已确认/已结算数据锁定：收款、成本、提成结算后不可静默修改。
3. 报表导出限流：单次行数上限、频率限制、超阈值二次确认。
4. 退税提交自动化测试：完整度 100%、不足 100%、管理员强制提交、归档、取消归档。
5. 附件下载/预览自动化测试：未登录、无权限、跨订单 documentId、已归档只读。
6. 操作日志字段增强：`userAgent`、`result`、`reason`、`requestId`。
7. 清理或统一 `DomesticLogisticsDocument` 模型，避免附件体系双轨。
8. 所有 API 引入 Zod/Joi 参数校验。

## P2：30 天内优化

1. 建立统一权限矩阵文件，API 路由自动声明权限。
2. 增加二人复核机制：收款确认、成本确认、汇率手动修改、提成结算。
3. 增加管理员强制操作审批：强制退税提交、取消归档、修改已确认数据。
4. 增加 PostgreSQL 和 R2 备份恢复演练。
5. 增加安全监控：异常登录、批量导出、频繁下载、越权失败。
6. 增加角色自动化测试：管理员、业务员、财务、成本录入员、物流资料录入员、查看者。
7. 增加前端 XSS 扫描和内部 ID 渲染扫描。

## 发布前安全验收

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run verify:ci`
- `npm run build`
- `npm run verify:release`
- `npm run audit`
- `npm run verify`
- `npm run db:deploy`
- 未登录访问所有 `/api/*` 业务接口返回 401。
- 各角色访问越权订单、客户、供应商、附件返回 403 或 404。
- 成本录入员不能自确认成本。
- 财务录入人不能确认自己的收款。
- CSV 公式注入被转义。
- 退税完整度不足 100% 不能提交。
- PDF 上传仅允许真实 PDF。
- R2 下载必须经后端签名和权限校验。
- 导出、下载、删除、提交退税均有操作日志。
