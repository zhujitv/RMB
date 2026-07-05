# NEXTWOOD 供应链协同平台安装部署说明

本文档用于指导管理员或技术人员完成 NEXTWOOD 供应链协同平台的本地安装、服务器部署、数据库迁移和上线前检查。

## 1. 部署方式选择

推荐生产环境使用：

- GitHub 托管源码
- Vercel 部署 Next.js 应用
- PostgreSQL 数据库
- Cloudflare R2 或兼容 S3 的私有对象存储
- Resend 邮件服务

本系统不建议直接使用本地电脑作为正式服务器。正式商用应部署到 Vercel 或同等级 Node.js 托管平台，并使用独立生产数据库。

## 2. 基础环境要求

本地开发或服务器构建需要：

- Node.js 20 或更高版本
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
- R2 / S3 私有文件存储
- Resend 邮件服务
- Upstash Redis 分布式限流

完成后会生成 `.env.local`。

如果 `.env.local` 已存在，向导会询问是否覆盖；不覆盖时会生成 `.env.local.generated`，方便人工核对后合并。

注意：初始化向导只生成环境变量文件，不会自动执行数据库迁移，也不会自动上传密钥到 Vercel。

### 手动配置

复制环境变量模板：

```bash
cp .env.example .env.local
```

然后编辑 `.env.local`。

### 必填配置

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
CRON_SECRET="use-a-long-random-secret"
BCRYPT_COST="12"
```

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

系统中的 PDF、合同、发票、报关资料等附件需要存储到 R2 或兼容 S3 的私有桶。

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
```

如果部署为多实例生产环境，建议配置 Upstash Redis：

```env
UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
RATE_LIMIT_NAMESPACE="nextwood"
```

未配置 Redis 时，系统会使用内存限流兜底。

### 可选第三方接口

根据实际使用情况配置：

- 阿里云 OCR / 文档智能
- 大掌柜 / ShipsGo 海运跟踪
- Webhook Secret

这些通常在系统设置页面维护。若有服务端环境变量要求，以 `.env.example` 和系统设置页面为准。

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

- `npm run build` 只构建应用。
- `npm run build:release` 会先执行 `prisma migrate deploy`，再构建应用。
- 生产环境发布前必须确认数据库备份已经完成。

## 9. Vercel 部署流程

推荐流程：

1. 在 GitHub 创建或使用现有仓库。
2. 在 Vercel 新建项目并连接该 GitHub 仓库。
3. 在 Vercel Project Settings -> Environment Variables 中配置 `.env.example` 中需要的变量。
4. 确认 Production 环境的 `DATABASE_URL` 指向生产数据库。
5. 确认 R2、邮件、OCR、ShipsGo 等密钥已经配置完整。
6. 推送代码到 `main` 分支。
7. Vercel 自动触发部署。

Vercel 构建命令使用项目默认配置：

```bash
npm run build
```

如果希望生产部署时自动执行数据库迁移，可将构建命令调整为：

```bash
npm run build:release
```

更稳妥的方式是：

1. 先手动备份数据库。
2. 手动执行迁移。
3. 再部署应用。

## 10. 首次上线检查清单

上线前至少检查：

- 数据库连接正常。
- 所有 Prisma migration 已执行。
- R2 / S3 私有桶可上传、预览、下载 PDF。
- 邮件服务可发送测试邮件。
- 管理员账号可登录。
- 业务员、财务、物流供应商、产品供应商角色权限正常。
- 应收订单、收款、成本、物流信息、物流费用、退税资料、资料回传核心流程可用。
- PDF 上传限制正常：仅支持 PDF，单个文件最大 5MB。
- 审计日志正常记录关键操作。
- 安全审计脚本通过。
- Vercel 最新部署状态为成功。

## 11. 灰度上线建议

建议分阶段上线：

1. 内部管理员和业务员先使用。
2. 接入少量真实订单。
3. 再开放给少量物流供应商和产品供应商。
4. 观察 1 到 2 周日志、权限、上传、邮件、OCR、海运跟踪等高风险点。
5. 稳定后再扩大使用范围。

## 12. 备份与恢复

生产环境必须建立备份策略。

至少备份：

- PostgreSQL 数据库
- R2 / S3 附件文件
- 生产环境变量

建议：

- 每日自动备份数据库。
- 每周做一次恢复演练。
- R2 / S3 开启版本控制或对象保留策略。
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

- R2 / S3 变量是否完整。
- 存储桶是否存在。
- Access Key 是否有读写权限。
- 文件是否为 PDF。
- 文件是否超过 5MB。

### 预览 PDF 失败但下载成功

检查：

- 预览接口是否返回 `Content-Type: application/pdf`。
- 预览接口是否返回 `Content-Disposition: inline`。
- 当前用户是否有文件预览权限。

### 部署后页面功能缺失

检查：

- Vercel 是否部署了最新 `main`。
- 环境变量是否配置到 Production。
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

- `v1.0.1`

每次正式发布建议：

1. 执行完整检查。
2. 提交代码。
3. 推送到 `main`。
4. 创建 Git tag。
5. 创建 GitHub Release。
6. 确认 Vercel 部署成功。
