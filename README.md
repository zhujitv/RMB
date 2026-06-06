# 外贸应收款协同管理平台

浙江莱诺建材有限公司外贸应收款协同管理平台，用于统一管理外贸订单应收、收款、成本、物流费用、出口单证、供应商资料、退税资料、利润分析和权限控制。

系统核心对象是“应收订单”。收款、成本、物流费用、出口单证、销售合同、供应商采购合同和工厂增值税发票都必须关联到真实订单，避免只靠手工订单号造成数据断裂。

## 技术栈

- Vercel
- Next.js
- PostgreSQL
- Prisma
- Cloudflare R2
- 原生 HTML/CSS/JavaScript 前端

## 功能模块

### 总览

老板驾驶舱视角，展示应收总额、已收金额、未收余额、逾期金额、即将到期金额和实际毛利。

包含：
- 逾期应收 Top 10
- 即将到期 Top 10
- 大额未收款 Top 10
- 低毛利 / 亏损订单 Top 10
- 月度应收 / 已收 / 未收趋势
- 客户未收款排行
- 业务员回款排行
- 成本结构统计

### 应收订单

业务员创建和维护应收订单。

支持：
- 订单号唯一校验
- 客户下拉选择
- 提单号后续补录
- 预计应收金额
- 实际发货金额
- 最终应收金额
- 预付款统计
- 付款条款
- 到期日和催款提醒
- 自动汇率快照
- 订单状态流转

付款条款包括：
- 见提单复印件付款
- OA 账期
- 到港后付款
- 分批付款

### 收款登记

财务登记回款，所有收款必须关联应收订单。

支持：
- 预付款
- 尾款
- 补差款
- 其他
- 只显示未收金额大于 0 的可收款订单
- 已收齐订单禁止新增重复收款
- 收款汇率快照
- 折人民币金额自动计算

已收金额统一由收款记录统计，不允许人工修改。

### 成本录入

成本录入员或管理员录入订单成本。

支持：
- 搜索选择关联应收订单
- 一次录入多家供应商成本
- 供应商必须从供应商资料中选择
- 保存 `supplierId`
- 保存 `supplierNameSnapshot`
- 自动汇率
- 付款状态
- 发票状态

成本类型包括：
- 工厂货款
- 国内物流费
- 报关费
- 港杂费
- 文件费
- 订舱费
- 海运费
- 目的港费用
- 保险费
- 佣金
- 样品费
- 银行手续费
- 其他物流费用
- 其他费用

### 物流费用

订单详情中支持录入物流费用，物流费用自动进入成本统计和利润分析。

物流费用类型：
- 国内拖车费
- 报关费
- 港杂费
- 文件费
- 订舱费
- 海运费
- 目的港费用
- 保险费
- 其他物流费用

### 出口单证与退税资料

订单详情中上传出口资料和销售合同。销售合同归入出口资料完整度。

出口资料固定项：
- 货物报关单
- 放行通知书
- 报关委托书
- 提单
- 商业发票
- 装箱单
- 销售合同

供应商资料在成本记录中上传：
- 工厂采购合同
- 工厂增值税发票

上传规则：
- 只允许 PDF
- 选择文件后立即上传
- 显示上传状态和进度
- 文件保存到 Cloudflare R2
- 数据库保存 R2 Key，不保存公开下载链接
- 下载时由后端生成签名 URL

### 退税资料完整度

退税资料管理页面展示：
- 出口资料完整度：已上传数量 / 7
- 供应商资料完整度：已上传数量 / 工厂供应商数量 × 2
- 如果订单没有工厂供应商，供应商资料完整度显示灰色“无工厂供应商资料要求”
- 存在工厂供应商后才统计工厂合同和工厂发票，0/2 为红色，1/2 为橙色，2/2 为绿色

总体完整度：

```text
总体完整度 = 已完成必检资料数量 / 应检查资料总数量
```

只有 `工厂供应商` 参与退税资料完整性检查。

保存成本时，如果成本类型为 `工厂货款`，但选择的供应商类型不是 `工厂供应商`，系统会提示是否进入供应商资料修改；用户确认继续保存时，会记录该次确认。

以下供应商类型不参与退税必检：
- 物流供应商
- 报关供应商
- 海运供应商
- 其他供应商

非工厂供应商的历史上传资料会保留，但不参与：
- 出口退税资料完整度
- 供应商资料完整度
- 总体完整度
- 退税资料包导出

### 退税资料包下载

财务和管理员可下载完整退税资料包。

ZIP 目录结构：

```text
出口资料/
  货物报关单.pdf
  放行通知书.pdf
  报关委托书.pdf
  提单.pdf
  商业发票.pdf
  装箱单.pdf
  销售合同.pdf

供应商资料/
  工厂供应商名称/
    工厂采购合同.pdf
    工厂增值税发票.pdf
```

ZIP 文件名：

```text
退税资料_{订单号}_{提单号}_{客户名称}.zip
```

### 利润分析

按订单自动计算：
- 最终应收金额
- 已到账金额
- 未收金额
- 总成本
- 预计毛利
- 实际毛利
- 毛利率
- 成本结构
- 逾期状态

### 报表导出

支持按当前筛选条件导出：
- 应收订单明细 CSV
- 收款明细 CSV
- 成本明细 CSV
- 订单利润分析 CSV
- 逾期催款报表 CSV
- 完整数据备份 JSON

### 系统设置

管理员可维护：
- 用户和权限
- 客户资料
- 供应商资料
- 汇率设置
- 操作日志

## 权限体系

系统支持两种权限模式：

### 固定角色权限

角色包括：
- 管理员
- 业务员
- 财务
- 成本录入员
- 查看者

### 自定义组合权限

管理员可为单个用户分配：
- 菜单权限
- 查看权限
- 操作权限

前端会隐藏无权限菜单和按钮，后端 API 会再次校验权限，不能只靠前端隐藏。

业务员默认只能查看：
- 自己负责的客户
- 自己创建或负责的订单
- 权限范围内的收款、成本和利润数据

## 数据库

主要数据表：
- `users`
- `customers`
- `suppliers`
- `receivable_orders`
- `payments`
- `order_costs`
- `order_documents`
- `exchange_rates`
- `system_settings`
- `attachments`
- `audit_logs`

所有业务数据保存在 PostgreSQL。浏览器本地缓存只用于表单草稿，不作为正式业务数据源。

## 环境变量

Vercel 需要配置：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require"
CRON_SECRET="change-me"
REMINDER_WEBHOOK_URL=""

R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key-id"
R2_SECRET_ACCESS_KEY="your-r2-secret-access-key"
R2_BUCKET="your-r2-bucket"
R2_ENDPOINT=""
```

也兼容以下 R2 变量名：

```bash
CLOUDFLARE_R2_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET
R2_ENDPOINT
```

### 文件服务器配置

PDF 单证和供应商资料必须保存到 Cloudflare R2 / S3 对象存储，不能保存到 Vercel 本地目录。Vercel 环境变量建议配置：

```text
R2_ACCOUNT_ID=Cloudflare 账户 ID
R2_ACCESS_KEY_ID=R2 API Token 的 Access Key ID
R2_SECRET_ACCESS_KEY=R2 API Token 的 Secret Access Key
R2_BUCKET=R2 存储桶名称
```

如果使用其他 S3 兼容存储，同时配置：

```text
R2_ENDPOINT=https://your-s3-endpoint
```

配置完成后，以管理员登录系统，访问：

```text
/api/storage/health
```

返回 `ok: true` 表示文件服务器可用。若配置错误，接口会返回明确错误，例如“文件存储服务未配置”“Access Key 错误”“Bucket 不存在”或“网络超时”。

## 定时任务

`vercel.json` 已配置：

```text
/api/reminders/run
/api/cron/exchange-rates
```

汇率任务每天自动拉取汇率并缓存到 `exchange_rates`。

## 默认账号

首次部署后系统会创建默认管理员：

```text
邮箱：admin@example.com
密码：12345678
```

上线后请立即修改默认管理员密码，或创建新的管理员并停用默认账号。

管理员新建用户时，如果“初始/新密码”留空，系统会使用默认 8 位初始密码：

```text
12345678
```

默认初始密码可通过环境变量 `DEFAULT_INITIAL_PASSWORD` 修改，必须设置为 8 位数字。所有默认初始密码登录后都应立即修改。

## 本地开发

安装依赖：

```bash
npm install
```

生成 Prisma Client：

```bash
npm run db:generate
```

运行开发服务：

```bash
npm run dev
```

访问：

```text
http://localhost:3000
```

## 数据库迁移

开发环境迁移：

```bash
npm run db:migrate
```

生产环境迁移：

```bash
npm run db:deploy
```

Vercel 构建时会自动执行：

```bash
prisma migrate deploy
prisma generate
next build
```

## 常用命令

```bash
npm run dev
npm run build
npm run start
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:studio
```

## 部署说明

1. 在 Railway 创建 PostgreSQL 数据库。
2. 将 Railway 提供的 PostgreSQL 外网连接填入 Vercel `DATABASE_URL`。
3. 在 Cloudflare R2 创建 Bucket 和访问密钥。
4. 将 R2 环境变量填入 Vercel，并用 `/api/storage/health` 检查文件服务器。
5. 在 Vercel 连接 GitHub 仓库。
6. 部署项目。
7. 首次部署后登录默认管理员账号。
8. 创建正式用户、客户、供应商和权限配置。

### 操作说明书部署备注

系统已在左侧导航新增“操作说明书”入口，并内置操作说明页面。相关静态前端文件已同步到根目录和 `public` 目录，后端角色菜单也已加入 `manual` 菜单权限。

如需将本地改动发布到线上平台，当前机器需先完成 Vercel 项目绑定或配置部署凭据：

```bash
vercel login
vercel link
vercel --prod
```

若使用自动部署，请将本地改动提交并推送到已连接 Vercel 的 GitHub 仓库，由 Vercel 自动构建发布。

## 安全注意事项

- 不要将 `.env` 提交到 GitHub。
- 不要公开 R2 Access Key 和 Secret Key。
- 上传文件只保存 R2 Key，下载时后端生成短期签名 URL。
- 所有新增、编辑、删除、上传、下载和退税状态修改都会记录操作日志。
- 删除订单不直接删除 R2 原始文件，避免退税资料丢失。
