# 外贸应收款协同管理平台

这是一个基于 Vercel、Next.js 和 PostgreSQL 的在线协同平台，用于管理外贸应收订单、客户回款、采购/物流/海运/佣金等成本，以及订单利润和逾期催款提醒。

核心对象是“应收订单”，不是发票。所有收款和成本都必须关联到应收订单的 `order_id`，系统不会只靠订单号文本匹配业务数据。

## 功能模块

- 总览：应收总额、已确认收款、待确认收款、未收余额、总成本、预计/实际毛利、毛利率、逾期和即将到期订单。
- 应收订单：业务员创建订单，记录客户、订单号、提单号、币种、汇率、应收金额、交易条款、付款条款、账期、到期日和状态。
- 收款登记：财务选择应收订单后登记回款，待确认收款单独统计，不计入正式已收金额。
- 成本录入：协同人员选择应收订单后录入采购、原材料、工厂货款、国内物流、报关、港杂、海运、保险、佣金、样品、银行手续费等成本。
- 利润分析：按订单自动计算应收、已收、未收、总成本、预计毛利、实际毛利、毛利率和逾期状态。
- 报表导出：按当前筛选条件导出应收订单、收款、成本、利润分析、催款提醒 CSV，以及完整 JSON 备份。
- 系统设置：用户、角色、客户资料、操作日志。

## 数据存储

正式业务数据只保存到 PostgreSQL：

- `users`
- `customers`
- `receivable_orders`
- `payments`
- `order_costs`
- `attachments`
- `audit_logs`

前端通过 API 与后端交互。`localStorage` 只用于表单草稿缓存，不作为应收、收款、成本等正式业务数据源。

## 默认账号

首次部署后系统会准备默认管理员：

```text
邮箱：admin@example.com
密码：admin123456
```

上线后请尽快在系统设置中新增正式管理员并停用或修改默认账号密码。

## 部署环境变量

Vercel 项目至少需要：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
CRON_SECRET="change-me"
REMINDER_WEBHOOK_URL=""
```

`REMINDER_WEBHOOK_URL` 为空时，定时任务只返回提醒清单，不主动发送消息。

## 构建与迁移

Vercel 构建时会自动执行：

```bash
prisma migrate deploy
prisma generate
next build
```

## 开发命令

```bash
npm install
npm run dev
```

当前工作机器没有 `npm` 命令，因此本地 Next.js 构建未在此环境执行；已对 JavaScript 文件执行语法检查。
