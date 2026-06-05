# 外贸收款与成本支出登记系统

这是一个本地单页登记系统，用于记录外贸订单出货应收、客户实际收款，以及货款、物流、佣金和其他成本支出。

## 使用方式

直接用浏览器打开 `index.html` 即可使用。数据保存在当前浏览器的 `localStorage` 中。

## 平台部署架构

项目已预留 Vercel + Next.js + PostgreSQL 架构：

- `app/`：Next.js App Router 入口和 API Routes。
- `public/`：当前可用的前端页面资源，Vercel 部署后访问 `/` 会跳转到 `/index.html`。
- `app/api/ledger`：从 PostgreSQL 读取应收、收款和成本数据。
- `app/api/import`：把前端当前数据同步写入 PostgreSQL。
- `app/api/invoices`、`app/api/receipts`、`app/api/costs`：日常新增/编辑记录的单条保存接口。
- `app/api/reminders`：读取到期/即将到期的催款提醒。
- `app/api/reminders/run`：Vercel Cron 调用入口，可选推送到 webhook。
- `prisma/schema.prisma`：PostgreSQL 数据模型。
- `prisma/migrations/20260605143000_init/migration.sql`：初始化表结构迁移。

部署前需要在 Vercel 项目环境变量中配置：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
CRON_SECRET="change-me"
REMINDER_WEBHOOK_URL=""
```

`REMINDER_WEBHOOK_URL` 为空时，定时任务只返回提醒清单，不主动发送消息；配置后会每天按 `vercel.json` 的 cron 调用发送 JSON payload。

本地或 CI 初始化命令：

```bash
npm install
npm run db:deploy
npm run build
```

开发调试命令：

```bash
npm run dev
```

当前这台机器没有 `npm` 命令，所以本地 Next.js 构建未在此环境执行；已完成 JavaScript 语法检查。

## 功能

- 应收发票：业务员在出货/开票时登记应收发票号、订单号、提单号、客户、业务员、币种、应收金额、汇率、账期和到期日。
- 收款登记：记录客户实际到账，按订单号自动匹配应收发票并计算未收余额。
- 成本支出：货款、物流、佣金、其他支出，支持关联订单号。
- 自动汇总：折人民币应收、实际收款、成本、应收毛利、利润率、未收余额、待确认收款。
- 订单盈亏：按订单号合并应收、已收和成本，计算单个订单利润与回款缺口。
- 催款提醒：可设置账期天数、账期到期日、提前提醒天数和提醒对象，到期前或逾期时在总览显示。
- 筛选：按月份、订单号、提单号、客户、供应商或业务员关键词筛选。
- 导出：应收发票 CSV、收款 CSV、成本 CSV、完整汇总 CSV。
- 备份：下载 JSON 备份并可再次导入恢复；旧版备份也可导入，应收发票会为空。

## 注意

本系统不连接银行或实时汇率服务，汇率需要手动录入。部署到平台后，数据会优先从 PostgreSQL 读取；如果数据库为空而浏览器已有本地数据，系统会尝试把本地数据同步到数据库。建议定期下载 JSON 备份。
