# NEXTWOOD 供应链协同平台安装部署说明

本文档用于指导管理员或技术人员完成 NEXTWOOD 供应链协同平台的本地安装、服务器部署、数据库迁移和上线前检查。

## 1. 部署方式选择

当前正式生产环境使用：

- GitHub 托管源码
- 腾讯云 CVM 运行 Next.js，Nginx 负责 HTTPS 反向代理，systemd 负责单进程守护
- 腾讯云数据库 PostgreSQL
- 腾讯云 COS 私有对象存储
- Resend 邮件服务

Vercel 发布配置已经移除，不作为当前发布、迁移或验收目标。本系统不建议直接使用本地电脑作为正式服务器；正式环境必须使用独立数据库和私有对象存储。代码版本统一从 GitHub 获取和回滚，腾讯云不保存代码版本副本。

## 2. 基础环境要求

本地开发或服务器构建需要：

- Node.js 22 或 24（项目要求 `>=22 <25`）
- npm
- PostgreSQL 数据库
- Git

项目主要技术栈：

- Next.js 16
- React 19
- TypeScript 6
- Prisma 7
- PostgreSQL

## 3. 获取代码

```bash
git clone git@github.com:zhujitv/RMB.git
cd RMB
```

如果使用 HTTPS：

```bash
git clone https://github.com/zhujitv/RMB.git
cd RMB
```

## 4. 安装依赖

```bash
npm install
```

安装后会自动执行 `prisma generate`，生成 Prisma Client。

## 5. 配置环境变量

### 傻瓜式初始化向导

推荐第一次安装时使用初始化向导：

```bash
npm run setup
```

向导会一步一步询问：

- PostgreSQL 数据库地址、端口、库名、用户名和密码
- 初始管理员姓名、邮箱和密码
- COS / R2 / S3 私有文件存储
- Resend 邮件服务
- 限流方式：腾讯云单 CVM、单 Node 进程可启用内存限流；多进程或多实例部署必须配置 Upstash Redis

完成后会生成 `.env.local`。

如果 `.env.local` 已存在，向导会询问是否覆盖；不覆盖时会生成 `.env.local.generated`，方便人工核对后合并。

注意：初始化向导只生成环境变量文件，不会自动执行数据库迁移，也不会自动上传密钥到腾讯云服务器。

### 手动配置

复制环境变量模板：

```bash
cp .env.example .env.local
```

然后编辑 `.env.local`。

### 必填配置

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require&uselibpqcompat=true"
APP_URL="https://your-production-domain.example.com"
CRON_SECRET=""
SETTINGS_ENCRYPTION_KEY=""
SETTINGS_ENCRYPTION_KEY_ID="primary-v1"
SETTINGS_ENCRYPTION_PREVIOUS_KEYS=""
BCRYPT_COST="12"
```

执行 `openssl rand -hex 32` 生成 `SETTINGS_ENCRYPTION_KEY`。密钥轮换时更新
`SETTINGS_ENCRYPTION_KEY_ID`，并暂时把旧密钥以
`{"old-key-id":"base64-or-hex-key"}` 的 JSON 格式配置到
`SETTINGS_ENCRYPTION_PREVIOUS_KEYS`，确认历史设置完成自动重加密后再移除旧密钥。
再独立执行一次 `openssl rand -hex 32` 生成 `CRON_SECRET`，两个密钥不能复用。

### 首次初始化管理员

空数据库首次部署时，可以配置：

```env
INITIAL_ADMIN_NAME="管理员"
INITIAL_ADMIN_EMAIL="admin@your-company.com"
INITIAL_ADMIN_PASSWORD="StrongPassword123"
```

注意：

- 生产环境禁止使用 `admin@example.com`、`12345678`、`admin123456`、`password` 等弱密码。
- 初始管理员创建后，建议删除或清空这些初始化变量。

### 文件存储配置

系统中的 PDF、合同、发票、报关资料等附件必须存储到私有对象存储。腾讯云生产环境优先使用 COS：

```env
COS_REGION="ap-shanghai"
COS_ENDPOINT="https://cos.ap-shanghai.myqcloud.com"
COS_SECRET_ID="your-cam-secret-id"
COS_SECRET_KEY="your-cam-secret-key"
COS_BUCKET="your-private-bucket-name-with-appid"
```

旧部署仍兼容 R2 或 S3：

```env
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET="your-r2-bucket"
R2_ENDPOINT=""
```

要求：

- 存储桶必须保持私有。
- 不要配置公开访问 URL。
- 文件预览和下载统一通过系统后端鉴权和签名访问。

### 邮件配置

```env
RESEND_API_KEY=""
RESEND_FROM="NEXTWOOD <notice@your-domain.com>"
RESEND_EMAIL_ENDPOINT=""
```

邮件功能用于：

- 注册邮箱验证
- 通知模板测试
- 物流费用开票通知
- 供应商资料回传通知
- 工作台提醒

### 限流配置

默认配置适合小团队使用：

```env
API_RATE_LIMIT_WINDOW_MS="60000"
API_RATE_LIMIT_READ_LIMIT="1000"
API_RATE_LIMIT_WRITE_LIMIT="300"
API_RATE_LIMIT_UPLOAD_LIMIT="60"
API_RATE_LIMIT_MEMORY_MAX_BUCKETS="20000"
```

生产环境默认必须配置 Upstash Redis：

```env
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
RATE_LIMIT_NAMESPACE="nextwood"
RATE_LIMIT_REDIS_TIMEOUT_MS="1500"
API_RATE_LIMIT_REGISTRATION_WINDOW_MS="900000"
API_RATE_LIMIT_REGISTRATION_LIMIT="5"
```

本地开发未配置 Redis 时，系统会使用内存限流。腾讯云 CVM 只有在“一台服务器、一个 Node 进程、没有 PM2 cluster/多副本”时，才能显式启用：

```env
SINGLE_INSTANCE_MEMORY_RATE_LIMIT="true"
```

这是单实例部署声明，不是通用 Redis 替代方案。增加第二台 CVM、改用 PM2 cluster/多 Node 进程或任何横向扩容前，必须先配置 Redis 并删除该开关。任何多进程、多实例或无服务器生产环境都不得设置该开关。

### 可选第三方接口

根据实际使用情况配置：

- 阿里云 OCR / 文档智能
- 大掌柜 / ShipsGo 海运跟踪
- Webhook Secret

这些通常在系统设置页面维护。若有服务端环境变量要求，以 `.env.example` 和系统设置页面为准。

阿里云接口默认只允许官方 HTTPS 域名。只有在确认自定义域名可信时，才使用以下逗号分隔白名单：

```env
ALIYUN_OCR_ALLOWED_HOSTS=""
ALIYUN_DOCMIND_ENDPOINT_ALLOWED_HOSTS=""
ALIYUN_DOCMIND_OUTPUT_ALLOWED_HOSTS=""
```

## 6. 初始化数据库

项目已经随代码包含完整 Prisma schema 和 migration。新建空数据库后，执行迁移命令会自动创建一套空白初始化表结构。

注意：迁移只创建表、索引、枚举和约束，不会带入现有业务数据、客户、订单、供应商、附件或历史记录。

本地开发数据库执行：

```bash
npm run db:migrate
```

生产数据库执行：

```bash
npm run db:deploy
```

也可以直接执行：

```bash
npx prisma migrate deploy
npx prisma generate
```

检查迁移状态：

```bash
npx prisma migrate status
```

## 7. 本地启动预览

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

如果 3000 端口被占用，Next.js 会提示使用其他端口。

## 8. 生产构建检查

上线前建议执行完整检查：

```bash
npm run typecheck
npm run lint
npm test
npm run security:audit
npm run build
```

如果需要同时验证生产数据库迁移：

```bash
npm run verify:release
```

说明：

- `npm run build` 在任何环境都只构建应用，普通 Git 或腾讯云构建不会自动执行 Prisma migration。
- `npm run build:release` 会先执行 `prisma migrate deploy`，再构建应用。
- 只有完成数据库备份并由受保护发布步骤显式调用时，才能使用 `npm run db:deploy` 或 `npm run build:release`。
- 生产环境发布前必须确认数据库备份已经完成。

## 9. 腾讯云 CVM 部署流程

当前生产只发布到腾讯云，GitHub 是源码和正式版本的唯一档案库。每个正式发布版本都必须在 GitHub 保存 commit、Git tag 和 GitHub Release。腾讯云 CVM 不保存源码压缩包、旧 release 目录或代码版本备份。

1. 在本地只选择本次功能文件提交，执行 `npm run verify:ci` 并推送到 GitHub `main`。
2. 等待 GitHub Actions 全部通过，为目标 commit 创建并推送 `vX.Y.Z` Git tag；`GitHub Release Archive` workflow 会自动创建 GitHub Release。
3. CVM 从 GitHub 拉取并检出同一 tag 或 commit SHA，执行 `npm ci`。
4. 核对 `DATABASE_URL`、COS、邮件、OCR、飞驼可视、限流和代理配置，但不要输出或覆盖现有密钥。
5. 执行 `npx prisma migrate status`。只有存在待执行 migration 时，才先确认数据库备份成功，并在维护窗口显式执行 `npm run db:deploy`。
6. 使用 `npm run build:app` 构建应用；普通构建不会自动迁移数据库。
7. 重启 systemd 应用服务，不在 CVM 创建代码压缩包、旧目录或版本副本。
8. 核对 systemd 服务正常、仅一个 `next-server` 进程、应用只监听本机端口，Nginx HTTPS 正常。
9. 确认服务器运行 SHA 与 GitHub SHA 一致，`www` 返回 200、裸域名正确跳转，再登录验收核心业务。

代码回滚时，从 GitHub 检出上一个正式 tag，重新安装依赖、构建并重启服务；不要依赖腾讯云上的旧代码目录。

只有在数据库已备份、连接目标已核对且由受保护发布步骤执行时，才可以使用：

```bash
npm run db:deploy
# 或显式迁移并构建
npm run build:release
```

禁止在普通构建命令中隐式加入 migration，禁止在生产使用 `prisma db push`、`prisma migrate dev` 或重建数据库。数据库迁移是向前执行，代码回滚不会自动撤销已经完成的 migration。

## 10. 首次上线检查清单

上线前至少检查：

- 数据库连接正常。
- 所有 Prisma migration 已执行。
- COS 私有桶可上传、预览、下载 PDF。
- 邮件服务可发送测试邮件。
- 管理员账号可登录。
- 业务员、财务、物流供应商、产品供应商角色权限正常。
- 报价、PI、手动确认、销售执行、工厂采购、供应商回复、生产交付、进入发货、应收订单和采购结算核心流程可用。
- 收款、成本、物流信息、物流费用、退税资料和资料回传原有流程可用。
- PDF 上传限制正常：仅支持 PDF，单个文件最大 10MB。
- 审计日志正常记录关键操作。
- 安全审计脚本通过。
- GitHub SHA、服务器运行 SHA、systemd 服务和真实公网页面均已核对。

## 11. 灰度上线建议

建议分阶段上线：

1. 内部管理员和业务员先使用。
2. 接入少量真实订单。
3. 再开放给少量物流供应商和产品供应商。
4. 观察 1 到 2 周日志、权限、上传、邮件、OCR、海运跟踪等高风险点。
5. 稳定后再扩大使用范围。

## 12. 业务数据保护与恢复

GitHub 已保存每个正式代码版本，腾讯云 CVM 不再保存代码版本备份。数据库备份和附件保护属于业务数据安全措施，不是代码版本备份，不能因为代码已保存在 GitHub 而取消。

至少备份：

- PostgreSQL 数据库
- COS / R2 / S3 附件文件
- 生产环境变量

建议：

- 每日自动备份数据库。
- 每周做一次恢复演练。
- COS / R2 / S3 开启版本控制或对象保留策略。
- 重要版本发布前手动备份一次数据库。

## 13. 常见问题

### 登录后提示无法读取账户信息

常见原因：

- `DATABASE_URL` 指向错误数据库。
- 生产数据库未执行最新 migration。
- Prisma Client 未重新生成。
- 用户、角色或权限数据缺失。

处理：

```bash
npx prisma migrate status
npm run db:deploy
npm run db:generate
```

### 上传文件失败

检查：

- COS / R2 / S3 变量是否完整。
- 存储桶是否存在。
- Access Key 是否有读写权限。
- 文件是否为 PDF。
- 文件是否超过 10MB。

### 预览 PDF 失败但下载成功

检查：

- 预览接口是否返回 `Content-Type: application/pdf`。
- 预览接口是否返回 `Content-Disposition: inline`。
- 当前用户是否有文件预览权限。

### 部署后页面功能缺失

检查：

- GitHub `main` 是否包含目标 commit，Actions 是否通过。
- 腾讯云工作目录和运行进程是否使用同一 commit SHA。
- systemd 服务是否已重启并运行目标版本。
- CVM 生产环境变量是否完整且仍指向正确数据库和 COS。
- 浏览器是否缓存旧页面。
- 对应角色是否有菜单权限。

### 数据库迁移失败

处理顺序：

1. 先备份数据库。
2. 查看迁移状态。
3. 确认当前代码与生产数据库 schema 是否匹配。
4. 再执行迁移。

```bash
npx prisma migrate status
npm run db:deploy
```

## 14. 发布版本

当前正式版本可在 GitHub Releases 查看：

- `v2.0.0`

每次正式发布必须：

1. 执行完整检查。
2. 提交代码。
3. 推送到 `main`。
4. 创建 Git tag。
5. 确认 GitHub 已自动创建对应 Release。
6. 在腾讯云拉取目标 SHA、构建并重启服务，不创建代码版本备份。
7. 确认数据库 migration、服务器 SHA、服务状态和真实公网页面。
