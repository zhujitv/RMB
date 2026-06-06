# 外贸应收款协同管理平台安全审计报告

审计日期：2026-06-06  
审计范围：登录与会话、权限控制、文件上传、Cloudflare R2、数据库、关键业务接口、日志、部署环境。  
审计说明：本次仅做代码审计和风险清单输出，未修改业务功能代码。

## 2026-06-06 中危问题修复记录

- 已为登录后的 `POST/PATCH/DELETE/PUT` 接口增加同源 `Origin/Referer` 校验，降低 CSRF 风险；登录接口不依赖既有会话，保持原逻辑。
- 自定义权限新增 `dataScope` 数据范围，并接入客户、订单、成本查询与订单对象级校验；管理员可在用户权限编辑器中配置数据范围。
- 汇率 Cron 接口已在生产环境强制要求 `CRON_SECRET`；未配置或密钥错误时拒绝执行。
- 订单号、客户名、供应商名的 active 唯一索引已在 `20260606110000_security_hardening` 迁移中建立。
- 物流费用的 `costConfirmed` 确认状态改为仅管理员/财务类权限可变更，业务员只能录入费用，不能确认物流成本。
- 报表导出已将提成字段独立受 `commissions` 读取权限控制，无提成权限时订单/利润报表不导出提成字段。
- 生产环境错误响应不再返回内部 `details`；R2 错误只返回安全可展示文案和错误码，provider 细节仅保留在服务端调试细节中。

## 2026-06-06 必须立即修复项完成记录

- Session 已改为服务端 `user_sessions` 可撤销会话，Cookie 仅保存随机 token；旧 `fta_user_id` 明文 userId Cookie 会被清除且不再作为认证凭证。
- 密码哈希改为 bcrypt；旧 SHA256/scrypt 哈希仅用于兼容登录，登录成功后自动升级为 bcrypt。
- 默认管理员使用 `INITIAL_ADMIN_PASSWORD` 登录时会被强制标记为首次改密；新建用户或管理员重置密码后也必须首次改密。
- 新增 `/api/auth/change-password`，强制改密完成后撤销现有会话并清除 Cookie，要求重新登录。
- 旧 `/api/attachments` 接口已停用，未登录仍返回 401，已登录访问返回 410；正式附件只允许通过订单单证 R2 上传接口。
- 成本录入员默认数据范围收窄为自己已录入成本关联的数据；搜索、查看、修改、删除均不再默认触达全量订单/成本。
- PDF 上传增加扩展名、MIME、大小、文件头 `%PDF-` 与尾部 `%%EOF` 校验。
- R2 对象 key 改为随机 UUID 文件名，不再包含原始文件名；前端响应不返回 `storageKey`/R2 key。
- R2 存储强制私有模式：如配置公开 R2 URL，系统会拒绝存储服务配置，下载统一经后端权限校验后生成签名 URL。

## 高危问题

### 1. 登录会话只依赖明文用户 ID Cookie

- 问题：登录后设置的 `fta_user_id` Cookie 值直接是用户 ID，未签名、未加密、不可撤销；默认管理员 ID 固定为 `admin-user`。
- 影响：如果 Cookie 被伪造或泄露，攻击者可能直接冒充用户，管理员风险最高；退出登录仅清理浏览器 Cookie，服务端没有让旧凭证失效的机制。
- 涉及文件/API：
  - `lib/platform-db.js`
  - `app/api/auth/login/route.js`
  - `/api/auth/login`
  - `/api/auth/logout`
- 修复建议：
  - 使用服务端 Session 表或签名 JWT。
  - Cookie 内只保存随机 sessionId。
  - 登出、停用用户、修改密码时服务端撤销 Session。
  - Cookie 使用 `__Host-` 前缀、短有效期、定期轮换。

### 2. 密码使用普通 SHA-256 哈希，登录无暴力破解限制

- 问题：密码存储使用 SHA-256，缺少盐值和慢哈希；默认管理员密码哈希硬编码；登录接口没有限流或失败锁定。
- 影响：数据库或日志泄露后密码容易被撞库破解；登录接口可被持续爆破。
- 涉及文件/API：
  - `lib/platform-db.js`
  - `app/api/auth/login/route.js`
  - `/api/auth/login`
- 修复建议：
  - 改用 Argon2id 或 bcrypt。
  - 删除默认管理员固定密码逻辑。
  - 首次部署时强制创建管理员并修改密码。
  - 增加 IP + 邮箱维度限流、失败锁定和登录审计。

### 3. 旧附件接口缺少对象级权限校验

- 问题：`/api/attachments` 只检查是否登录或是否有附件写权限，没有根据 `relatedType/relatedId` 反查业务对象权限。
- 影响：任意登录用户可能按关联 ID 查询附件；有附件写权限的用户可能给任意对象新增附件 URL 或删除任意附件。
- 涉及文件/API：
  - `app/api/attachments/route.js`
  - `app/api/attachments/[id]/route.js`
  - `/api/attachments`
- 修复建议：
  - 停用旧 `attachments` 接口，统一迁移到 `order_documents`。
  - 如继续保留，必须按 `relatedType` 反查订单、成本、客户等对象，并校验当前用户权限。
  - 删除附件时必须校验对象归属和操作权限。

### 4. 成本录入员数据范围过宽

- 问题：`listCosts` 仅限制业务员数据范围，成本录入员可看到接近全量成本；成本保存和删除依赖 `canAccessOrder`，而非业务员角色读取订单时范围较宽。
- 影响：成本录入员可能越权查看、修改、删除其他订单成本。
- 涉及文件/API：
  - `lib/platform-db.js`
  - `/api/costs`
  - `/api/costs/[id]`
- 修复建议：
  - 增加独立的 `costAccessWhere`、`assertCanAccessCost`。
  - 成本录入员仅允许访问自己创建或被分配订单的成本。
  - 删除、修改成本时同时校验 `cost.createdById` 或明确的订单授权关系。

### 5. 文件上传缺少 PDF 文件头校验，R2 Key 暴露且可预测

- 问题：上传只校验扩展名和 MIME，没有校验 PDF 文件头；接口序列化时返回 `storageKey/r2Key/r2Bucket`；R2 key 主要由订单 ID、单证类型、时间戳、文件名组成，可预测。
- 影响：可上传伪装 PDF；如果 R2 桶误设公开，攻击者可能猜测路径访问文件；对象存储目录结构暴露。
- 涉及文件/API：
  - `app/api/order-documents/route.js`
  - `lib/platform-db.js`
  - `lib/r2.js`
  - `/api/order-documents`
  - `/api/order-documents/[id]/download`
- 修复建议：
  - 后端校验 `%PDF-` 文件头，必要时使用 PDF 解析器做基础验证。
  - storageKey 增加 UUID 或随机前缀。
  - 前端响应不返回 bucket、storageKey、r2Key。
  - 确认 R2 桶为私有，仅允许后端生成短期签名下载链接。

### 6. 审计日志可能记录密码哈希等敏感字段

- 问题：`writeAudit` 保存完整 before/after 数据，用户新增或修改时可能记录 `passwordHash`。
- 影响：审计日志泄露密码哈希，违反“不记录密码、Token、Access Key、Secret Key”的安全要求。
- 涉及文件/API：
  - `lib/platform-db.js`
  - `/api/audit-logs`
  - `/api/users`
  - `/api/users/[id]`
- 修复建议：
  - 写日志前统一脱敏。
  - 过滤 `passwordHash`、`password`、`token`、`secret`、`accessKey`、`storageKey` 等字段。
  - 日志只保留必要字段和差异摘要。

## 中危问题

### 1. 写接口缺少 CSRF 防护

- 问题：所有写接口依赖 Cookie 认证，但未见 CSRF Token 校验。
- 影响：虽然 `SameSite=Lax` 有一定保护，但关键财务写操作仍建议增加专门防护。
- 涉及文件/API：
  - `POST/PATCH/DELETE /api/*`
- 修复建议：
  - 增加 CSRF Token 或双重提交 Cookie。
  - 写接口校验 Origin/Referer。

### 2. 自定义权限缺少独立数据范围

- 问题：自定义权限支持菜单、读、写组合，但没有独立数据范围配置。
- 影响：给非业务员角色配置订单写权限时，可能默认获得全量订单范围。
- 涉及文件：
  - `lib/platform-db.js`
- 修复建议：
  - 权限模型增加 `dataScope`。
  - 支持全部、本人、负责客户、被分配订单、自定义客户/订单集合。

### 3. 汇率定时接口在未配置 `CRON_SECRET` 时可公开调用

- 问题：`CRON_SECRET` 未配置时，`/api/cron/exchange-rates` 不校验密钥。
- 影响：外部可触发汇率刷新写库，造成资源消耗或污染操作节奏。
- 涉及文件/API：
  - `app/api/cron/exchange-rates/route.js`
  - `/api/cron/exchange-rates`
- 修复建议：
  - 生产环境强制要求 `CRON_SECRET`。
  - 未配置时直接返回 500 或 403。
  - Vercel Cron 请求应带密钥或内部校验。

### 4. 业务唯一性缺少数据库约束

- 问题：订单号、客户名、供应商名唯一性主要靠代码查询，数据库没有完整唯一约束。
- 影响：并发提交时可能产生重复业务主键。
- 涉及文件：
  - `prisma/schema.prisma`
  - Prisma migrations
- 修复建议：
  - 增加数据库唯一索引。
  - 建议对未删除数据建立 `lower(trim(name/order_no))` 的部分唯一索引。

### 5. 业务员可提交物流成本确认状态

- 问题：物流费用保存时可提交 `costConfirmed`，该状态参与提成可结算判断。
- 影响：业务员可能提前把物流成本标记为已确认，影响财务结算判断。
- 涉及文件/API：
  - `lib/platform-db.js`
  - `/api/logistics-costs`
  - `/api/commissions/[orderId]/settle`
- 修复建议：
  - 物流成本确认仅允许管理员、财务或指定成本审核角色操作。
  - 业务员只能录入费用，不能确认成本完成。

### 6. 报表导出可能泄露提成字段

- 问题：订单/利润 CSV 中包含提成字段，但普通 `reports` 权限即可导出部分报表。
- 影响：非管理员、非财务或非本人业务员可能看到不应查看的提成信息。
- 涉及文件/API：
  - `app/api/reports/route.js`
  - `/api/reports`
- 修复建议：
  - 提成字段单独受 `commissions` 读取权限控制。
  - 业务员只能导出本人订单提成。
  - 查看者默认不应看到敏感提成明细。

### 7. 错误响应可能返回内部 details

- 问题：`apiError` 会把 `error.details` 返回给前端。
- 影响：对象存储 providerCode、缺失环境变量名、内部错误细节可能泄露。
- 涉及文件：
  - `lib/platform-db.js`
  - `lib/r2.js`
- 修复建议：
  - 生产环境只返回安全错误码和用户友好文案。
  - 详细错误仅写服务端日志。

## 低危问题

### 1. 未登录 HTML 仍包含隐藏业务结构

- 问题：未登录时页面只显示登录页，但 HTML 中仍包含隐藏业务模块结构。
- 影响：不泄露业务数据，但会暴露页面结构。
- 涉及文件：
  - `index.html`
- 修复建议：
  - 登录后再加载业务壳。
  - 或使用 Next.js 服务端路由/中间件保护业务页面。

### 2. 缺少统一安全响应头

- 问题：未见 CSP、`frame-ancestors`、HSTS、Referrer-Policy 等安全响应头配置。
- 影响：抗 XSS、点击劫持、混合内容防护不足。
- 涉及文件：
  - `next.config.mjs`
- 修复建议：
  - 在 Next.js/Vercel 配置统一安全 headers。

### 3. Next.js 依赖使用 latest

- 问题：`next` 依赖使用 `latest`。
- 影响：构建不可重复，升级可能带来兼容或安全回归。
- 涉及文件：
  - `package.json`
- 修复建议：
  - 固定 Next.js 版本。
  - 通过锁文件和安全公告定期升级。

### 4. R2 健康检查返回 bucket 和 endpoint

- 问题：存储健康检查会返回 bucket 和 endpoint。
- 影响：管理员可见通常可接受，但不建议长期在前端展示存储细节。
- 涉及文件/API：
  - `lib/r2.js`
  - `/api/storage/health`
- 修复建议：
  - 前端只显示“已配置/未配置/错误码”。
  - 详细存储信息只写服务端日志。

## 必须立即修复

1. 重做 Session：禁止用明文 userId Cookie，增加服务端可撤销会话。
2. 密码改 Argon2id/bcrypt，并增加登录限流和默认管理员强制改密。
3. 修复 `/api/attachments` 对象级权限，或直接停用旧附件接口。
4. 收窄成本录入员的数据权限，防止查看、修改、删除全量成本。
5. 加固 PDF 上传和 R2：文件头校验、随机 storageKey、前端不返回 R2 key、确认桶私有。

## 建议补充测试

- 未登录访问所有业务 `/api/*` 返回 401，废弃接口仅返回 410。
- 手动伪造 `fta_user_id=admin-user` 必须失败。
- 登录连续失败触发限流或锁定。
- 管理员、业务员、财务、成本录入员、查看者分别测试菜单、列表、详情、新增、编辑、删除权限。
- 使用他人的 `orderId/customerId/supplierId/documentId/costId` 调接口必须返回 403 或 404。
- 上传 `.exe.pdf`、HTML、SVG、ZIP 改后缀、错误 MIME、超 20MB、伪 PDF 文件头，必须失败。
- R2 未配置、Access Key 错误、Bucket 不存在、数据库写入失败时返回明确错误。
- 下载文件必须经过后端权限校验，猜 URL 或猜 storageKey 不能下载。
- 审计日志不得包含 passwordHash、Token、Access Key、Secret Key。
- 前端篡改 `amountCny/exchangeRate/commissionRate/costConfirmed/taxRefundStatus` 时，后端必须重新计算或拒绝。

## 已观察到的现有安全控制

- 主要业务 API 多数已调用 `getActor` 进行登录校验。
- 订单、客户、付款、单证、退税等主链路已有部分后端权限判断。
- 订单单证上传已限制 PDF 扩展名、MIME 和 20MB 大小。
- 单证下载已通过后端权限校验后生成短期签名 URL。
- 退出登录时前端会清理表单草稿、状态和上传队列。
- `.gitignore` 已排除 `.env` 和 `.env*.local`，当前仓库只保留 `.env.example`。
