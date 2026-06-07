# 全站安全审计报告

## 1. 审计摘要

- 审计时间：2026-06-08
- 审计对象：外贸应收与单证协同平台（TRD Platform）
- 审计范围：前端、后端 API、Prisma Schema、权限控制、财务流程、退税归档、附件上传下载、报表导出、部署配置
- 参考标准：OWASP Web Security Testing Guide、OWASP Top 10、OWASP API Security Top 10、内部业务权限审计标准
- 总体安全评分：78 / 100
- Critical：0
- High：5
- Medium：10
- Low：6
- Info：5

### 已具备的安全基线

- 已使用服务端可撤销会话，Cookie 设置 `httpOnly`、生产环境 `secure`，会话表为 `UserSession`，见 [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:646)。
- 登录接口使用邮箱大小写不敏感查询，支持 `bcryptjs` 密码校验和旧哈希升级，见 [app/api/auth/login/route.js](/Volumes/工作/外贸收款/app/api/auth/login/route.js:73)。
- 已停用、待审核、审核拒绝用户不能登录，见 [app/api/auth/login/route.js](/Volumes/工作/外贸收款/app/api/auth/login/route.js:98)。
- 业务 API 大多通过 `getActor()`、`assertRead()`、`assertWrite()` 做后端鉴权，见 [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:734)。
- 退税提交已在后端校验完整度，低于 100% 默认禁止提交，见 [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js) 的 `updateTaxRefundStatus()`。
- R2 存储要求私有桶，禁止配置公开 URL，见 [lib/r2.js](/Volumes/工作/外贸收款/lib/r2.js:15)。
- PDF 上传已校验扩展名、MIME、文件头 `%PDF-`、文件尾 `%%EOF`、20MB 大小限制，见 [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:4522)。
- 旧 `/api/attachments` 接口已停用并返回 410，见 [app/api/attachments/route.js](/Volumes/工作/外贸收款/app/api/attachments/route.js:1)。
- 主业务数据大量采用软删除或归档字段，例如订单、收款、成本、客户、供应商、单证，见 [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:191)。

### 最优先修复事项

1. 禁止成本录入员自行确认普通成本。
2. 修复 CSV 导出公式注入风险。
3. 收窄成本录入员通过应收搜索接口枚举全部订单的权限。
4. 收窄物流资料录入员可查看全部国内物流订单的权限。
5. 增加财务收款确认、成本确认、提成结算后的锁定与复核机制。

## 2. 风险等级说明

- Critical：可直接导致系统接管、大规模数据泄露、登录绕过、附件公开泄露或财务状态被任意篡改。
- High：可导致敏感数据越权、关键财务数据错误、退税错误提交、附件越权访问、重要审计缺失。
- Medium：可导致局部越权、审计链不完整、部署不稳定、业务风控不足或中等规模数据泄露。
- Low：安全影响较低，但会降低可审计性、可维护性或后续扩展安全。
- Info：当前无直接漏洞，但建议作为安全基线继续完善。

## 3. 问题清单

### SEC-001

- 风险等级：High
- 所属模块：成本管理 / 财务安全
- 问题描述：成本录入员可以在保存普通成本时直接提交 `costConfirmed=true`，后端未限制普通成本确认人必须为管理员或财务。
- 影响范围：成本确认、利润分析、业务员提成、退税资料完整度。
- 复现方式：以“成本录入员”调用 `POST /api/costs` 或 `PATCH /api/costs/{id}`，在请求体中带 `costConfirmed: true`。
- 风险原因：`saveCost()` 只检查 `assertWrite(actor, "costs")`，`buildCostData()` 接收前端的 `costConfirmed`。物流费用已有 `canConfirmLogisticsCost(actor)` 保护，但普通成本缺少同等保护。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3980) `saveCost()`
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:438) `OrderCost.costConfirmed`
  - `/api/costs`
- 修复建议：普通成本确认动作单独拆成 `POST /api/costs/{id}/confirm`，仅管理员、财务可确认；成本录入员保存成本时后端强制 `costConfirmed=false` 或保持原状态。
- 验收标准：成本录入员提交 `costConfirmed=true` 后数据库仍为未确认；管理员或财务确认后才变为已确认，并写入操作日志。

### SEC-002

- 风险等级：High
- 所属模块：报表中心 / 数据导出
- 问题描述：CSV 导出未防护公式注入。以 `=`, `+`, `-`, `@` 开头的客户名、供应商名、备注等字段会原样写入 CSV。
- 影响范围：下载 CSV 后在 Excel/WPS 中打开，可能触发公式执行、外链请求或数据泄露。
- 复现方式：创建客户名称为 `=HYPERLINK("https://evil.example","click")`，导出 CSV。
- 风险原因：`csvCell()` 仅处理逗号、引号、换行，未对公式前缀转义。
- 涉及文件/API：
  - [lib/report-service.js](/Volumes/工作/外贸收款/lib/report-service.js:343) `csvCell()`
  - `/api/reports/export`
- 修复建议：CSV 单元格若 trim 后以 `=`, `+`, `-`, `@` 开头，前置单引号或制表符；同时记录导出日志。
- 验收标准：导出的 CSV 中危险前缀被转义，Excel 打开不执行公式。

### SEC-003

- 风险等级：High
- 所属模块：应收订单搜索 / 成本管理 / IDOR
- 问题描述：成本录入员通过 `/api/receivables/search` 可绕过自身成本范围搜索全部订单。
- 影响范围：订单号、提单号、客户、业务员、币种、汇率、最终应收金额等数据。
- 复现方式：以成本录入员调用 `/api/receivables/search?q=`，接口为 `OWN_COST` 角色使用空的 `accessWhere`。
- 风险原因：`searchReceivableOrders()` 中 `canWrite(actor, "costs") && scope === "OWN_COST" ? {} : orderAccessWhere(actor)` 放宽了订单查询范围。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3181) `searchReceivableOrders()`
  - `/api/receivables/search`
- 修复建议：成本录入员只能搜索“被授权可录入成本的订单”，或搜索结果仅返回订单号、提单号、客户简称等必要字段，不返回金额、汇率、业务员等敏感字段。
- 验收标准：成本录入员无法枚举全量订单；未授权订单不返回敏感金额字段。

### SEC-004

- 风险等级：High
- 所属模块：国内物流信息 / 数据权限
- 问题描述：物流资料录入员可查看全部国内物流订单，而不是被分配或授权的订单。
- 影响范围：订单号、提单号、客户简称、运输资料状态、报关资料状态。
- 复现方式：以“物流资料录入员”登录或请求 `/api/domestic-logistics`，当前 `canAccessDomesticLogisticsOrder()` 对该角色直接返回 true。
- 风险原因：为简化物流模块，供应商绑定逻辑被删除，但后端没有补充订单分配或授权范围。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:3092) `canAccessDomesticLogisticsOrder()`
  - `/api/domestic-logistics`
- 修复建议：新增订单级物流资料录入授权表，或由业务员/管理员分配可录入订单；物流资料录入员默认只能看被分配订单。
- 验收标准：物流资料录入员手动请求未分配订单返回 403 或列表不显示。

### SEC-005

- 风险等级：High
- 所属模块：收款管理 / 财务复核
- 问题描述：拥有收款写权限的用户可以直接保存 `status=已到账`，系统缺少二次复核或双人确认机制。
- 影响范围：已收金额、未收余额、逾期判断、利润分析、提成结算。
- 复现方式：财务用户新增收款并直接设置状态为“已到账”。
- 风险原因：`PAYMENT_STATUSES` 允许“已到账”，保存逻辑由单个财务角色完成，未区分“录入”和“确认到账”权限。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:13) `PAYMENT_STATUSES`
  - `/api/payments`
- 修复建议：拆分“收款录入”和“到账确认”权限；录入人不能确认自己录入的收款；确认动作写入确认人、确认时间、银行流水凭证。
- 验收标准：单个录入人不能将自己创建的收款直接改为已到账；确认必须有独立日志。

### SEC-006

- 风险等级：Medium
- 所属模块：登录与认证
- 问题描述：登录失败限制为 15 分钟内 8 次，未达到建议的“连续 5 次锁定 30 分钟”要求。
- 影响范围：暴力破解防护。
- 风险原因：`LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000`，`LOGIN_RATE_LIMIT_MAX_FAILURES = 8`。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:165)
  - `/api/auth/login`
- 修复建议：改为 5 次失败锁定 30 分钟；按 IP + email 双维度计数；在前端显示剩余解锁时间。
- 验收标准：同一账号 5 次失败后 30 分钟内无法继续尝试。

### SEC-007

- 风险等级：Medium
- 所属模块：登录与账号安全
- 问题描述：密码策略只有最小 8 位，未强制同时包含字母和数字。
- 影响范围：弱密码风险、管理员账号被猜测风险。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:163)
  - `/api/auth/change-password`
  - `/api/users`
- 修复建议：新增密码复杂度：至少 8 位，至少 1 个字母和 1 个数字；管理员建议至少 12 位。
- 验收标准：纯数字或纯字母密码提交失败，提示中文原因。

### SEC-008

- 风险等级：Medium
- 所属模块：数据库 / 业务唯一性
- 问题描述：订单号、客户名称、供应商名称主要依赖应用层校验，数据库未设置唯一约束。
- 影响范围：并发创建时可能产生重复订单号、重复客户、重复供应商。
- 风险原因：`ReceivableOrder.orderNo`、`Customer.name`、`Supplier.supplierName` 仅为索引，不是唯一约束。
- 涉及文件：
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:129) `Customer`
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:155) `Supplier`
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:191) `ReceivableOrder`
- 修复建议：增加唯一约束或规范化字段，例如 `normalizedName`、`normalizedSupplierName`、`orderNo @unique`；历史重复数据先清理后迁移。
- 验收标准：并发重复提交时数据库返回唯一约束错误，接口返回明确中文提示。

### SEC-009

- 风险等级：Medium
- 所属模块：数据删除安全
- 问题描述：主业务多为软删除，但删除/作废动作缺少“删除原因”强制输入。
- 影响范围：订单、收款、成本、客户、供应商、单证。
- 风险原因：`deleteCost()` 等函数写入 `deletedAt`，但未要求 `deleteReason`。
- 涉及文件/API：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:4037) `deleteCost()`
  - `/api/orders/{id}`、`/api/payments/{id}`、`/api/costs/{id}`、`/api/order-documents/{id}`
- 修复建议：删除、作废、停用统一要求原因；AuditLog 记录删除前完整数据、原因、IP、User-Agent。
- 验收标准：未填写原因不能删除；日志中可查看原因和删除前数据。

### SEC-010

- 风险等级：Medium
- 所属模块：操作日志
- 问题描述：操作日志表缺少 `userAgent` 字段，导出报表、登录成功、退出登录等关键行为未形成统一 AuditLog。
- 影响范围：事后追责、异常下载排查、内控审计。
- 涉及文件：
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:522) `AuditLog`
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:5193) `listAuditLogs()`
  - [lib/report-service.js](/Volumes/工作/外贸收款/lib/report-service.js:396) `exportReport()`
- 修复建议：AuditLog 增加 `userAgent`、`result`、`reason`；登录成功/失败、退出、导出、下载资料包、取消归档全部写入统一日志。
- 验收标准：审计日志能查到谁在何时何 IP 用何浏览器导出了哪类报表。

### SEC-011

- 风险等级：Medium
- 所属模块：部署配置
- 问题描述：`npm run build` 会执行 `prisma migrate deploy`，Vercel 构建阶段会直接修改生产数据库。
- 影响范围：部署失败、迁移不可控、回滚困难。
- 涉及文件：
  - [package.json](/Volumes/工作/外贸收款/package.json:5)
- 修复建议：`build` 改为 `prisma generate && next build`；迁移通过独立命令 `npm run db:deploy` 在发布前执行。
- 验收标准：Vercel build 不再执行数据库迁移；迁移日志由发布流程独立记录。

### SEC-012

- 风险等级：Medium
- 所属模块：安全响应头 / 前端安全
- 问题描述：`next.config.mjs` 未配置安全响应头，例如 CSP、X-Frame-Options、Referrer-Policy、Permissions-Policy。
- 影响范围：XSS 缓解、点击劫持、跨站资源泄露。
- 涉及文件：
  - [next.config.mjs](/Volumes/工作/外贸收款/next.config.mjs:1)
- 修复建议：通过 Next `headers()` 增加安全头；PDF 预览页可单独允许 `object-src` / `frame-src` 自身域名。
- 验收标准：线上响应头包含 CSP、frame-ancestors、referrer-policy、permissions-policy。

### SEC-013

- 风险等级：Medium
- 所属模块：报表中心 / 数据导出
- 问题描述：报表导出 `allFiltered` 时最多取 100000 行，缺少审批、导出频率限制和导出日志。
- 影响范围：敏感数据大批量外泄。
- 涉及文件/API：
  - [lib/report-service.js](/Volumes/工作/外贸收款/lib/report-service.js:396)
  - `/api/reports/export`
- 修复建议：大于阈值导出需要管理员/财务二次确认；限制单次最大行数；导出写入 AuditLog。
- 验收标准：普通用户不能导出全量敏感数据，所有导出可审计。

### SEC-014

- 风险等级：Medium
- 所属模块：财务数据锁定
- 问题描述：已确认成本、已到账收款、已结算提成后的基础数据缺少统一锁定策略。
- 影响范围：利润、提成、历史报表一致性。
- 涉及文件/API：
  - `/api/payments`
  - `/api/costs`
  - `/api/commissions/{orderId}/settle`
- 修复建议：已到账收款修改需财务主管权限和原因；已确认成本修改需撤销确认；已结算提成后禁止修改影响提成的成本、收款、订单金额，或触发重算差异单。
- 验收标准：结算后修改基础数据会被后端拒绝或生成差异审批记录。

### SEC-015

- 风险等级：Medium
- 所属模块：DomesticLogisticsDocument / 数据模型
- 问题描述：`DomesticLogisticsDocument` 表仍使用 `filePath`，无 `deletedAt`，未统一到 `OrderDocument` 的 R2 元数据和软删除模型。
- 影响范围：后续若启用该表，可能出现本地路径、物理删除或权限不一致。
- 涉及文件：
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:319)
- 修复建议：确认该表是否废弃；如保留，应增加 `r2Bucket`、`storageKey`、`mimeType`、`uploadStatus`、`deletedAt`，并套用统一附件权限。
- 验收标准：所有附件表均使用 R2 私有对象 key，下载统一走后端权限校验。

### SEC-016

- 风险等级：Low
- 所属模块：附件 / 遗留接口
- 问题描述：旧 `Attachment` 表和部分函数仍存在，虽然 API 已 410 停用。
- 影响范围：后续维护时可能误启用旧附件体系。
- 涉及文件：
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:503)
  - `/api/attachments`
- 修复建议：保留迁移兼容，但在代码中明确标记 deprecated；新增测试确保 `/api/attachments` 永远返回 410。
- 验收标准：旧附件接口不可上传、不可下载、不可被前端引用。

### SEC-017

- 风险等级：Low
- 所属模块：PDF 预览权限
- 问题描述：PDF 预览接口比下载接口更严格，要求 `taxRefund` 读取权限，可能导致有单证查看权的业务角色无法预览。
- 影响范围：功能体验，不是直接安全漏洞。
- 风险原因：`getOrderDocumentPreview()` 同时要求 `documents` 和 `taxRefund`。
- 修复建议：预览和下载统一使用 `documents` 权限 + 订单归属校验；退税资料入口再额外限制页面访问。
- 验收标准：有资料查看权限的角色可预览自己权限内 PDF，未授权角色仍返回 403。

### SEC-018

- 风险等级：Low
- 所属模块：错误返回
- 问题描述：大部分 API 使用 `apiError()`，但需要持续确认生产环境不返回堆栈、数据库结构或环境变量。
- 修复建议：生产环境统一只返回 `code/message`，详细错误写服务端日志。
- 验收标准：故意触发 Prisma 错误时前端不显示 SQL、字段名、栈信息。

### SEC-019

- 风险等级：Low
- 所属模块：CSRF
- 问题描述：已有 Same-Origin 检查和 SameSite Cookie，但尚未使用独立 CSRF Token。
- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:628)
- 修复建议：保留 Same-Origin 检查，同时为关键财务 POST/PATCH/DELETE 增加 CSRF Token。
- 验收标准：跨站表单请求无法完成付款确认、成本确认、退税提交。

### SEC-020

- 风险等级：Low
- 所属模块：账号唯一性
- 问题描述：邮箱登录应用层大小写不敏感，但数据库 `User.email @unique` 在 PostgreSQL 默认大小写敏感，理论上可插入大小写不同的邮箱。
- 涉及文件：
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:46)
- 修复建议：新增 `normalizedEmail @unique` 或使用 PostgreSQL `citext`。
- 验收标准：数据库层拒绝 `Marc@nextwood.com` 与 `marc@nextwood.com` 并存。

### SEC-021

- 风险等级：Info
- 所属模块：退税安全
- 检查结论：总体完整度不足 100% 时，后端已有禁止提交逻辑；管理员强制提交需系统开关和原因。
- 涉及文件/API：
  - `/api/tax-refunds/{orderId}`
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js)
- 建议：增加自动化测试覆盖 READY/SUBMITTED/forceSubmit 三种场景。

### SEC-022

- 风险等级：Info
- 所属模块：R2 文件安全
- 检查结论：R2 密钥仅服务端使用；公开桶配置会被拒绝；下载使用后端签名链接；数据库保存 `storageKey` 而非公开 URL。
- 涉及文件：
  - [lib/r2.js](/Volumes/工作/外贸收款/lib/r2.js:15)
  - [prisma/schema.prisma](/Volumes/工作/外贸收款/prisma/schema.prisma:369)
- 建议：增加 R2 Bucket 策略审计截图或 IaC 配置，确认生产桶未公开。

### SEC-023

- 风险等级：Info
- 所属模块：CRON 接口
- 检查结论：`/api/reminders/run` 和 `/api/cron/exchange-rates` 均使用 `assertCronSecret()`，不是公开触发。
- 涉及 API：
  - `/api/reminders/run`
  - `/api/cron/exchange-rates`
- 建议：定期轮换 `CRON_SECRET`，并将失败写入监控。

### SEC-024

- 风险等级：Info
- 所属模块：前端内部 ID
- 检查结论：操作日志生产环境隐藏 `entityId`、`beforeData`、`afterData`；业务页面仍需用浏览器逐页检查内部 ID 是否残留。
- 涉及文件：
  - [lib/platform-db.js](/Volumes/工作/外贸收款/lib/platform-db.js:5193)
- 建议：加入 UI 自动化扫描，搜索页面文本中的 `cmq`/`cuid` 模式。

### SEC-025

- 风险等级：Info
- 所属模块：依赖与供应链
- 检查结论：`package.json` 依赖均固定版本，未使用 `latest`。
- 涉及文件：
  - [package.json](/Volumes/工作/外贸收款/package.json:15)
- 建议：增加 `npm audit` 或 GitHub Dependabot。

## 4. 必须重点判断的问题结论

| 检查项 | 当前结论 |
| --- | --- |
| 订单是否存在物理删除风险 | 主订单为软删除，见 `deletedAt`，但删除原因不完整 |
| 退税完整度不足 100% 是否仍可提交 | 默认不能，管理员强制提交需开关和原因 |
| 附件下载是否可以未授权访问 | 下载接口有登录、资料权限、订单归属校验 |
| 普通用户是否可以调用管理员接口 | 主要管理员接口有 `assertWrite(settings/users)`，未发现直接绕过 |
| 成本录入人是否可以自己确认成本 | 存在风险，普通成本确认未限制 |
| 收款是否可以未经复核直接变已到账 | 存在风险，缺少二人复核 |
| 汇率是否可以被普通用户修改 | 普通用户不能，管理员/财务可刷新或手动汇率 |
| 提成比例是否可以被非管理员修改 | 客户资料和订单提成比例主要由管理员控制，未发现业务员直接修改 |
| 报表是否可以导出全部敏感数据 | 授权用户可导出大量数据，缺少导出日志和行数控制 |
| 操作日志是否缺少修改前后数据 | 有 before/after，但缺 userAgent、结果、原因，部分动作未统一记录 |
| token 是否退出后仍然有效 | 退出会撤销当前 session，已停用用户 session 会失效 |
| 已停用用户是否还能访问系统 | `getActor()` 要求 `isActive=true` 和 `APPROVED`，不能访问 |
| CSV 导出是否存在公式注入风险 | 存在 |
| 上传文件是否允许危险类型 | 当前订单单证接口仅允许 PDF，并校验文件头/尾 |
| CORS 是否配置过宽 | 未发现显式宽 CORS；但安全响应头需要加强 |

## 5. 立即修复清单

1. 普通成本确认拆分为独立复核接口，仅管理员/财务可确认。
2. CSV 导出增加公式注入转义。
3. `/api/receivables/search` 对成本录入员收窄数据范围或脱敏字段。
4. 国内物流信息为物流资料录入员增加订单级授权范围。
5. 收款新增与到账确认拆分，录入人不能确认自己录入的收款。
6. `AuditLog` 增加 `userAgent/result/reason`，导出和下载写日志。
7. 删除、作废、取消归档、强制退税提交全部要求原因。
8. `build` 脚本移除 `prisma migrate deploy`。
9. `next.config.mjs` 增加安全响应头。
10. 报表导出增加最大行数、频率限制和审批提示。

## 6. 7 天内修复清单

1. 密码复杂度升级：至少 8 位且包含字母和数字，管理员建议 12 位。
2. 登录失败策略改为 5 次失败锁定 30 分钟。
3. 为 `orderNo`、客户名称、供应商名称增加数据库唯一性保障。
4. 已确认成本、已到账收款、已结算提成建立修改锁定和撤销流程。
5. 统一所有下载、预览、资料包下载的审计日志。
6. 建立安全回归测试：未登录、无权限、IDOR、附件下载、CSV 注入、退税提交。
7. 确认 `DomesticLogisticsDocument` 是否废弃，避免和 `OrderDocument` 双轨。
8. 报表中心增加归档范围、权限和大批量导出告警测试。

## 7. 30 天内优化清单

1. 引入 Zod/Joi 做所有 API 参数结构化校验。
2. 建立统一权限中间件和路由权限清单，避免每个 route 手写。
3. 引入双人复核机制：收款确认、成本确认、汇率手动修改、提成结算。
4. 增加安全响应头和 CSP 精细化策略。
5. 建立备份与恢复演练，覆盖 PostgreSQL 和 R2。
6. 建立权限矩阵自动化测试，覆盖管理员、业务员、财务、成本录入员、物流资料录入员、查看者。
7. 增加导出水印或下载责任声明。
8. 对敏感日志和操作记录做长期归档策略。

## 8. 建议新增安全机制

- 全局权限中间件：统一声明每个 API 的 `read/write/admin` 权限。
- API 参数校验：所有请求体使用 Zod/Joi 校验并返回明确错误码。
- 统一操作日志：登录、退出、导出、下载、删除、作废、状态修改、金额修改全覆盖。
- 软删除机制：业务数据只允许软删除、作废、停用、归档。
- 财务复核机制：收款确认、成本确认、汇率修改、提成结算必须复核。
- 退税完整度后端强校验：已具备，建议增加自动化测试。
- 附件权限校验：已具备，建议覆盖资料包下载和预览测试。
- 导出权限校验：增加导出日志、行数限制、CSV 注入防护。
- 登录失败锁定：调整为 5 次失败锁定 30 分钟。
- 会话过期：已具备，建议增加会话列表和管理员强制下线。
- 安全响应头：在 `next.config.mjs` 增加 CSP、frame-ancestors、referrer-policy。
- 数据备份机制：PostgreSQL 每日备份，R2 生命周期和版本保留策略。

## 9. 总结

当前系统最大风险不是登录绕过或附件公开泄露，这些核心风险已经有较好防护。最大风险集中在内部业务权限和财务内控：成本录入员可自确认普通成本、收款可由单人直接确认到账、报表导出缺少 CSV 注入防护和导出审计、部分角色的数据搜索范围过宽。

必须先修的问题是 SEC-001、SEC-002、SEC-003、SEC-004、SEC-005。它们直接影响财务数据真实性、敏感数据边界和外部导出安全。

后续优化可以围绕权限中间件、复核流程、审计日志、数据库唯一约束和安全响应头展开。

修复后验收建议：

- 使用 6 类角色逐个执行 API 越权测试。
- 用未登录状态访问所有下载、预览、导出接口，必须返回 401。
- 用低权限用户篡改 `orderId/customerId/supplierId/documentId`，必须返回 403 或 404。
- 构造 CSV 公式字段导出，Excel 打开不得执行公式。
- 构造退税完整度不足订单，后端必须禁止 SUBMITTED。
- 构造非 PDF、伪 PDF、超大 PDF 上传，后端必须拒绝。
