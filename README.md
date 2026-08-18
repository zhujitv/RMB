# NEXTWOOD 供应链协同平台

NEXTWOOD 供应链协同平台用于统一管理客户报价、销售执行、工厂采购、生产交付、应收收款、采购结算、物流费用、出口单证、供应商资料、退税资料、利润分析和权限控制。

系统业务主线是“报价 / 直接销售执行 → 工厂采购 → 生产交付 → 发货应收 → 结算与归档”。进入发货后生成的应收订单继续关联收款、成本、物流费用、出口单证、供应商采购合同和工厂增值税发票，避免只靠手工订单号造成数据断裂。

## 安装部署

安装、部署、环境变量、数据库迁移和上线检查说明见：[docs/INSTALLATION.md](docs/INSTALLATION.md)。

## 技术栈

- 腾讯云 CVM、Nginx 与 systemd
- Next.js 16
- React 19
- TypeScript 6
- 腾讯云数据库 PostgreSQL
- Prisma 7
- 腾讯云 COS 私有对象存储（兼容旧 R2 / S3 配置）
- Resend 邮件服务
- 阿里云 OCR / 文档智能
- 飞驼可视海运、港区和海关跟踪接口
- 正式主入口：React + TypeScript（`/`）
- 旧版原生 HTML/CSS/JavaScript 业务入口已退役

## 前端迁移路线

当前系统保留现有 API、Prisma 和数据库结构。新版 React + TypeScript 前端已切换到首页 `/` 作为正式入口，目前已完成基础框架和主要业务模块迁移：

- 登录页
- 权限初始化
- 左侧导航
- 基础布局
- 不加载业务数据的工作台首页
- 报价管理与英文形式发票
- 销售执行与工厂采购分配
- 产品供应商工厂采购单门户
- 应收订单
- 收款管理
- 成本管理
- 物流信息
- 利润分析
- 退税资料
- 报表中心
- 系统设置
- 操作手册
- 客户沟通
- 运输监控
- 物流费用
- 资料回传
- 工作台待办

迁移原则：

- 默认访问根路径 `/` 会直接进入 React 工作台首页。
- 旧版前端业务入口已退役，不再承载任何业务功能。
- 业务修复和新功能统一进入 React + TypeScript 工作台。
- 新功能和模块迁移优先进入 React + TypeScript 骨架。
- 每迁移一个模块，必须完成权限、数据、上传、导出和回归验证。
- 新业务闭环顺序：报价或直接销售执行、工厂采购、生产交付、进入发货、应收收款、采购结算、物流单证、退税归档。
- 业务修复必须保持现有应收、成本、物流、退税和报表链路兼容，不能绕开原有订单主数据。

当前迁移验收状态：

- 报价管理：已完成，已验收
- 销售执行：已完成，已验收
- 工厂采购单门户：已完成，已验收
- 应收订单：已完成，已验收
- 收款管理：已完成，已验收
- 成本管理：已完成，已验收
- 物流信息：已完成，已验收
- 退税资料：已完成，已验收
- 报表中心：已完成，已验收
- 系统设置：已完成，已验收

详细迁移检查清单见：`app/WORKSPACE_MIGRATION_PLAN.md`。

## 功能模块

### 总览

老板驾驶舱视角，展示应收总额、已收金额、未收余额、逾期金额、即将到期金额、预计毛利和已实现毛利。

包含：
- 逾期应收 Top 10
- 即将到期 Top 10
- 大额未收款 Top 10
- 低毛利 / 亏损订单 Top 10
- 月度应收 / 已收 / 未收趋势
- 客户未收款排行
- 业务员回款排行
- 成本结构统计

### 工作台待办

工作台首页只加载权限和待办摘要，不在首页预加载所有业务数据。

待办来源包括：
- 逾期应收和即将到期收款
- 待完善物流信息
- 物流费用审核、开票和付款节点
- 供应商资料回传任务
- 退税资料缺失、异常和待提交
- 大掌柜 / ShipsGo 跟踪异常或待同步

待办提醒会按业务负责人和权限范围生成。逾期待办可通过通知中心发送邮件提醒，并记录每日提醒日志，避免重复发送。

### 报价管理与形式发票

管理员和业务员可创建客户报价，业务主体必须手动选择。报价明细使用“产品描述（含规格）”、单位、数量和单价；相同客户的历史产品与同币种最近单价可复用，首次录入的新产品会自动保留。

报价号与 PI 发票号按日期生成，例如 `20260809`、`20260809A`。每次编辑会生成不可变版本；每个版本可预览、下载或通过邮件发送固定的英文形式发票 PDF。邮件投递不代表客户接受，只有业务员根据邮件、微信、WhatsApp、电话等外部凭证执行“手动确认”后，当前版本才可转为销售执行。

### 销售执行与工厂采购

已接受报价可转入销售执行；老客户或无需重复报价的业务可直接创建销售执行。客户订单号和客户要求交货日期必填。每行保存产品描述、销售数量、销售单价和单件 / 单套净重，并按工厂和采购币种完整分配数量。

发货前不再执行的销售执行应先填写原因作废。管理员可在已作废详情中输入客户订单号进行永久删除；系统会物理删除关联采购、确认、生产、装柜和附件数据，并保留本次管理员删除操作的审计摘要。已进入发货或关联应收订单的业务不能永久删除。

单一工厂订单可使用整单默认工厂；多工厂订单按产品拆分。工厂使用模糊查找，采购单价允许留空等待首次回复时回填；首次非拒绝回复也可确认不同的下发价，确认后锁定，后续差额进入费用调整。正式下发后，销售内容和工厂分配锁定，并按工厂生成独立采购单。

### 工厂采购、生产与结算

产品供应商可在工厂采购单门户回复；未使用门户的工厂可通过微信、电话、邮件、纸质等方式确认，由有权限的内部人员在原采购单上代录价格、交期、改期或拒绝。两种来源共用同一状态机和不可变确认记录，系统同时保存供应商实际确认时间与内部登记时间。没有门户账号只会跳过邮件通知，不阻止采购单下发。

每家已接受且满足预付款条件的工厂可独立开始生产，不必等待其它工厂。生产完成既可由供应商在门户确认，也可由内部人员根据线下回复代录；内部人员随后登记不可修改的实际交付日期。确认依据说明和凭证附件均为选填，可在确认后补传或替换，缺失或上传失败不会阻止生产、交付、付款、结算或发货。所有有效采购单均已接受、完工并登记实际交付后，销售执行才可进入发货并生成关联应收订单草稿。当前版本不包含质检模块。

采购执行支持预付款、尾款、临时包装费 / 人工费等调整。首次确认交期后有 10 天免罚期，第 11 天起按冻结采购基数的 `0.003% / 天` 计算延误违约金，默认不设上限。最终结算后只允许登记尾款，累计付款达到最终应付时自动结清，并向成本管理同步只读的工厂货款成本。

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
- 发票状态自动判断：已上传有效工厂增值税发票 PDF 为 `已收到`，否则为 `未收到`

成本类型包括：
- 工厂货款
- 拖车费
- 报关费
- 港杂费
- 海运费
- 保险费
- 国外佣金
- 国外代理费
- 样品费
- 银行手续费
- 其他物流费用
- 其他费用

历史数据中的 `国内物流费` 和 `国内拖车费` 会按 `拖车费` 统计，`文件费` 和 `订舱费` 会按 `港杂费` 统计；`目的港费用` 不再作为我方退税资料必检成本。

### 物流费用

订单详情中支持录入物流费用，物流费用自动进入成本统计和利润分析。

物流费用类型：
- 拖车费
- 报关费
- 港杂费
- 海运费
- 保险费
- 其他物流费用

在新版 React 工作台中，物流费用入口保留在 `物流信息` 模块的单票订单详情内：

- 点击某票订单的 `详情`
- 点击 `录入费用`
- 按该票订单录入拖车费、报关费、港杂费、海运费等物流费用
- 选择订单后显示订单号、提单号、客户简称、车牌和货物摘要
- 物流供应商账号录入时，供应商由账号自动锁定；管理员录入时只允许选择物流类供应商

该入口与线上旧版功能保持一致，属于“每票订单物流费录入”，不是左侧独立的“物流费用登记”菜单。

`物流信息` 页面下方保留旧版一致的 `物流费用录入` 列表区，可查询费用记录、刷新、导出对账单，并处理审核、发票确认和付款状态。费用审核不依赖发票；审核通过后进入待开票并通知供应商，发票上传入口仅在审核通过后显示，全部发票确认后才进入待付款。

### 物流信息

物流信息用于满足出口发票备注和退税资料归档要求，记录的是税务要求的首程运输事实数据，不依赖物流供应商。

录入字段：
- 运输方式：车辆运输、快递运输、多式联运
- 车牌号
- 挂车车牌
- 起运地
- 到达地
- 起运日期
- 运输货物名称
- 快递单号
- 出口发票备注

出口发票备注由系统自动生成，禁止手工编辑：

```text
车辆运输：
车牌号：浙D12345
起运日：2026-01-01
起运地：绍兴越城

挂车运输：
车牌号：浙D12345/浙D6789挂
起运日：2026-01-01
起运地：绍兴越城

快递运输：
快递单号：SF123456789
到达地：上海外高桥堆场
运输货物名称：木塑地板
```

物流信息页面支持业务范围筛选：
- 当前业务
- 已归档业务
- 全部业务

物流供应商登录后默认进入 `物流信息`，左侧只显示该工作入口和账户相关操作。

React 工作台中的物流信息已迁移：
- 默认以订单为主列表，未录入或未提交物流信息的订单优先显示
- 支持多集装箱 / 多车运输明细
- 支持报关资料上传、预览、下载和权限控制
- 支持单票订单内直接录入物流费用

### 海运跟踪

物流信息支持大掌柜 / ShipsGo 海运跟踪。

支持：
- 按提单号、Booking No. 和柜号创建海运跟踪
- 保存船公司、船名航次、起运港、目的港、ETD、ETA 和状态
- 同步集装箱轨迹、事件时间线和原始响应
- 按权限查看对应订单的跟踪记录
- 管理员可删除、恢复和补同步跟踪记录

系统设置中的 `物流接口` 可维护：
- API Base URL
- API Key
- 海运跟踪开关
- 手动同步 / 每日自动同步
- Webhook Secret
- Live Map 和 Credit 预警开关

### 出口单证与退税资料

订单详情、物流信息和成本记录共同完成退税资料归档。销售合同归入出口资料完整度；报关单、放行通知书和报关委托书也会作为报关资料单独统计。

出口资料固定项：
- 提单
- 商业发票
- 装箱单
- 销售合同
- 出口发票

报关资料固定项：
- 货物报关单
- 放行通知书
- 报关委托书

物流信息固定项：
- 运输方式
- 车牌号 / 快递单号
- 起运地
- 到达地
- 起运日期
- 运输货物名称
- 出口发票备注

产品供应商资料通过资料回传任务上传，并最终归集到退税资料：
- 工厂采购合同
- 工厂增值税发票

物流资料在对应成本记录中上传：
- 拖车费发票
- 报关费发票
- 港杂费发票
- 海运费发票（仅 CIF / CFR 或实际录入海运费时要求）

上传规则：
- 只允许 PDF
- 选择文件后立即上传
- 显示上传状态和进度
- 上传或删除工厂增值税发票后，成本发票状态自动更新，不允许通过手工选择绕过附件检查
- 文件保存到腾讯云 COS 私有桶（旧部署兼容 R2 / S3）
- 数据库只保存对象存储 Key，不保存公开下载链接
- 下载时由后端生成签名 URL

### 退税资料完整度

退税资料管理页面展示：
- 报关资料完整度：已上传数量 / 3
- 出口资料完整度：已上传数量 / 5
- 物流信息完整度：1 / 1
- 产品供应商资料完整度：合格资料数量 / 产品供应商必需资料数量
- 物流资料完整度：FOB 默认 3 项，CIF / CFR 默认 4 项
- 总体完整度：所有必检资料完成数量 / 所有必检资料总数量

退税资料列表只显示：
- 订单号
- 提单号
- 客户名称
- 总体完整度
- 退税状态
- 操作

React 工作台中的退税资料列表保持轻量，只显示订单号、客户简称、申报日期、总体完整度、退税状态和详情入口。点击详情后显示一个紧凑下拉菜单：
- 查看资料
- 下载资料包
- 提交退税
- 取消归档
- 缺失资料汇总

缺失资料标签可点击，系统会打开“查看资料”抽屉并自动定位到对应上传或维护区域，例如提单、商业发票、报关单、物流信息、工厂合同、工厂发票、拖车费发票、报关费发票和港杂费发票。

各类完整度和缺失项明细在“查看资料”抽屉中管理，避免列表过宽。

产品供应商资料规则：
- 如果订单还没有关联任何产品供应商，供应商资料完整度显示 `0/2（未录入产品供应商）`
- 每一家产品供应商都需要回传 `工厂采购合同` 和 `工厂增值税发票`
- 多家产品供应商会逐家计算，例如 3 家产品供应商总要求为 6 项
- 产品供应商回传文件后，系统自动执行 OCR 识别和内容校验
- 合同和发票均已上传，且 OCR 识别成功、校验通过、未发现异常时，资料回传任务自动变为已完成
- 只有 OCR 识别失败、字段缺失、金额异常、供应商异常、购买方异常、合同订单号异常、发票重复等风险情况，才需要管理员人工确认或驳回重传
- OCR 完全通过时不再显示“人工确认通过”，避免把自动校验变成人工审批

总体完整度：

```text
总体完整度 = 报关资料 + 出口资料 + 物流信息 + 产品供应商资料 + 物流资料
```

只有 `产品供应商` 参与退税资料完整性检查。

保存成本时，如果成本类型为 `工厂货款`，但选择的供应商类型不是 `产品供应商`，系统会提示是否进入供应商资料修改；用户确认继续保存时，会记录该次确认。

以下供应商类型不参与退税必检：
- 物流供应商
- 报关供应商
- 海运供应商
- 港杂费用供应商
- 其他供应商

非产品供应商的历史上传资料会保留，但不参与：
- 供应商资料完整度
- 总体完整度
- 退税资料包导出

产品供应商资料 OCR 校验规则：
- 增值税发票校验销售方、购买方、价税合计、税率、发票号重复和产品名称
- 采购合同校验供应商、采购方、采购订单号、合同金额和产品明细
- 采购合同订单号比较会先做规范化：去空格、去换行、统一全角半角、统一大写、去中文标点
- 采购合同订单号支持多订单号拆分和排序比较，例如 `PO24-2/PO24-12` 与 `PO24-12 / PO24-2` 可判定一致
- 采购合同订单号支持常见 OCR 容错，例如 `O/0`、`I/1`、`S/5`、`B/8`、`Z/2`
- OCR 结果写入独立 OCR 表，不直接覆盖订单、供应商、成本或退税核心字段

物流资料规则：
- FOB：默认检查 `报关费资料`、`拖车费资料`、`港杂费资料`
- CIF / CFR：在 FOB 三项基础上增加 `海运费资料`
- EXW、FOB、DAP、DDP 等非 CIF / CFR 条款默认不强制要求海运费资料
- FOB 订单的海运费由买方承担，系统不允许新增海运费成本；历史海运费记录保留审计，但不计入订单成本、利润、净现金流或提成基数
- CIF / CFR 等由卖方承担海运费的订单，已录入海运费成本或发票时仍按原规则纳入资料检查

退税提交规则：
- 总体完整度必须达到 100% 才允许提交退税
- 点击 `提交退税` 或把状态改为 `已提交退税 / SUBMITTED` 时，系统会先校验完整度
- 资料不足时会提示当前完整度和缺失资料，并阻止提交
- 系统设置中可开启 `管理员忽略退税完整度`，默认关闭；开启后管理员强制提交必须填写原因，并记录操作日志
- 管理员和财务可在当前资料列表中直接修改退税状态；档案和已提交退税订单只读
- 选择 `已提交退税` 时不会静默保存，而是进入提交退税确认和归档流程

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
  产品供应商名称/
    工厂采购合同.pdf
    工厂增值税发票.pdf
```

ZIP 文件名：

```text
退税资料_{订单号}_{提单号}_{客户名称}.zip
```

### 清关资料发送

清关资料邮件统一在【客户沟通】模块按订单发送。退税资料详情不再显示客户邮件发送入口。

发送前系统会准备：
- 收件邮箱
- 抄送邮箱
- 邮件语言
- 邮件标题
- 邮件正文
- 可发送资料清单

Commercial Invoice、Packing List、报关单缺失时禁止发送，并显示明确缺失项。

发送记录会写入 `shipping_document_notifications`，包含收件人、抄送人、邮件语言、发送状态、错误信息和发送人。邮件附件从 R2 读取，发送失败不会改变订单、单证或退税资料主数据。

### 通知中心

系统通知统一由通知模板驱动，并通过 Resend 发送邮件。

通知类型包括：
- 账号邮箱验证
- 清关资料通知（英文 / 中文 / 俄语）
- 物流费用开票通知
- 产品供应商资料回传通知
- 工作台逾期待办提醒

通知中心会保存：
- `notification_templates`：模板、变量、收件人配置和启停状态
- `notification_outbox`：待发送、发送中、已发送和失败记录
- `notification_delivery_logs`：投递结果、失败原因和关联业务对象

安全敏感模板不可随意关闭；普通业务模板可在系统设置的 `通知模板` 中维护标题、正文、抄送、收件邮箱读取顺序和测试发送。

### 退税提交与归档

退税状态保留：
- `NOT_READY`：资料不完整
- `READY`：资料完整待提交
- `PROBLEM`：资料异常
- `SUBMITTED`：已提交退税

`SUBMITTED` 不是普通状态，而是归档触发动作。当财务或管理员确认退税资料已递交税务局后，订单会自动写入：
- `taxArchived = true`
- `taxArchivedAt`
- `taxArchivedBy`
- `taxSubmittedAt`
- `taxSubmittedBy`

归档的业务含义：
- 归档不是删除数据
- 归档不是关闭订单
- 归档只代表退税资料递交完成，把订单从日常资料收集工作列表移入档案
- 订单、收款、成本、物流信息、单证和附件全部完整保留
- 收款管理默认不因退税归档而隐藏，因为退税归档不代表货款已经收齐；尚有未收余额的归档订单仍参与即将到期和逾期催款提醒

归档后默认隐藏的位置：
- 退税资料当前资料列表
- 成本管理当前业务列表
- 物流信息当前业务列表
- 经营总览中的退税资料、成本资料和物流资料待处理清单；尚有未收余额的订单例外，仍保留应收催款提醒

归档后仍可查询的位置：
- 退税资料 → 退税档案
- 成本管理 → 已归档业务 / 全部业务
- 物流信息 → 已归档业务 / 全部业务
- 报表中心 → 已归档业务 / 全部业务

管理员可以在退税档案中执行 `取消归档`，让订单重新回到当前资料、成本管理和物流信息默认列表。

### 利润分析

按订单自动计算：
- 最终应收金额
- 已到账金额
- 未收金额
- 总成本
- 预计毛利
- 预计毛利率
- 已实现毛利
- 已实现毛利率
- 成本结构
- 逾期状态
- 业务员提成
- 提成状态

利润口径：

```text
预计毛利 = 最终应收金额 - 已确认总成本
预计毛利率 = 已实际发货订单的预计毛利 / 对应最终应收金额

已实现毛利 = 已实际发货且客户款项收齐后的预计毛利
已实现毛利率 = 已实现毛利 / 最终应收金额
```

利润率统计资格以已登记实际发货日期、实际发货金额，或已提交退税归档为准。提交退税归档时，早于发货阶段的订单状态自动推进为“已发货”，但不会伪造发货日期；已进入收款阶段或已关闭、已取消的状态不倒退。车辆运输或多式联运保存后，系统取最早的国内起运日期自动写入应收订单发货时间；散货进舱、快递不参与同步，且不同的人工发货日期不会被覆盖。普通未发货订单仍保留预计毛利金额用于预测，但利润率显示“未发货”，且不进入低毛利、亏损订单和利润率排行；客户款项未收齐时，已实现毛利率显示 `--`。

### 报表中心

报表中心定位为“在线查询 + 按需下载”，进入页面不会自动生成全部报表。

React 工作台中的报表中心已完成并通过一致性验收：
- 支持按权限显示报表标签
- 支持在线筛选、分页、勾选、排序
- 支持当前页 / 已勾选 / 当前查询结果导出 Excel / CSV
- 支持从报表明细跳转到对应业务模块继续处理

支持报表类型：
- 应收订单明细
- 收款明细
- 成本明细
- 利润分析
- 业务员提成
- 逾期催款
- 退税资料

查询流程：

```text
选择报表类型 → 填写查询条件 → 点击查询 → 在线查看结果 → 勾选数据或选择范围 → 下载 CSV / Excel
```

支持下载范围：
- 当前查询结果
- 已勾选数据
- 当前页

报表中心支持业务范围筛选：
- 当前业务
- 已归档业务
- 全部业务

### 系统设置

React 工作台中的系统设置已完成旧版显性差异补齐，并已通过人工最终一致性验收。已补齐内容包括：

- 汇率设置补回 `手动刷新今日汇率`
- 供应商资料补回 `类型 / 状态` 筛选
- 用户与权限补回 `角色 / 状态` 筛选
- 操作日志补回 `动作` 筛选
- 客户 / 供应商 / 用户详情补回 `删除 / 停用` 操作

管理员可维护：
- 公司资料
- 业务主体
- 用户和权限
- 客户资料
- 供应商资料
- OCR 识别
- 物流接口
- 通知模板
- 汇率设置
- 提成公式
- 操作日志
- 后台任务和慢接口

### OCR 识别设置

系统设置中的 `OCR识别` 统一维护识别服务。

支持：
- 阿里云 OCR / 文档智能配置
- 报关单识别模式：自动、严格结构化、手工
- 产品供应商资料回传 OCR 开关
- 发票结构化识别开关
- PDF 文本兜底开关
- 超时时间配置
- 独立报关单 PDF 测试识别

退税资料模块内的专用 OCR 和退税计算接口已停用。报关单信息以手工维护和资料完整度流程为准；产品供应商资料回传 OCR 仍可在资料回传任务中执行。

系统设置提供独立的“腾讯云报关单 OCR 测试（实验）”：管理员可配置加密保存的腾讯云 SecretId / SecretKey，上传不超过约 7MB 的报关单 PDF，同时比较报关单专用识别与表格识别 V3。测试文件不保存、不关联订单，识别结果不写入报关或退税业务数据；通过真实样本验收后才能进入后续业务集成。

## 权限体系

系统支持两种权限模式：

### 固定角色权限

角色包括：
- 管理员
- 业务员
- 财务
- 物流供应商
- 产品供应商
- 物流资料录入员

### 自定义组合权限

管理员可为单个用户分配：
- 菜单权限
- 查看权限
- 操作权限

前端会隐藏无权限菜单和按钮，后端 API 会再次校验权限，不能只靠前端隐藏。

业务员默认只能查看：
- 自己负责的客户
- 自己负责的报价、销售执行和订单
- 权限范围内的收款、成本和利润数据

财务默认可查看全部销售执行、应收、收款和成本，并维护采购付款；产品供应商仅可查看绑定本工厂的采购单和资料回传任务。自定义权限可以进一步收紧菜单、读写和数据范围，但不能突破角色边界。

## 登录、注册与账号审核

未登录时系统只显示登录页面，不加载业务菜单和业务数据。登录成功后，系统会根据当前用户角色和自定义权限加载菜单、按钮和数据范围。

### 自助注册

普通用户可以在登录页提交注册申请。注册后账号状态为“待审核”，在管理员审核通过并分配正确角色与数据范围前不能进入业务系统。

管理员审核路径：

```text
系统设置 → 用户和权限 → 待审核用户 → 通过 / 拒绝
```

审核通过后账号状态变为“已通过”，用户才能登录。拒绝或停用账号后，后端会撤销该用户现有会话。

### 初始密码

生产环境不提供固定默认管理员和固定默认密码。

管理员新建用户时必须填写“初始/新密码”，禁止留空使用统一默认密码。管理员重置密码后，系统会强制该用户首次登录修改密码。

## 数据库

主要数据表：
- `users`
- `user_sessions`
- `login_attempts`
- `customers`
- `suppliers`
- `sales_quotations`
- `sales_quotation_versions`
- `sales_executions`
- `sales_execution_versions`
- `factory_purchase_orders`
- `factory_purchase_order_supplier_responses`
- `factory_purchase_order_payments`
- `factory_purchase_order_adjustments`
- `factory_purchase_order_settlements`
- `receivable_orders`
- `domestic_logistics_infos`
- `domestic_logistics_documents`
- `payments`
- `order_costs`
- `order_documents`
- `commission_settlements`
- `exchange_rates`
- `system_settings`
- `audit_logs`
- `file_assets`
- `factory_document_requests`
- `ocr_tasks`
- `ocr_raw_results`
- `ocr_results`
- `shipping_document_notifications`
- `shipsgo_trackings`
- `shipsgo_tracking_containers`
- `logistics_expense_bills`
- `logistics_invoice_groups`
- `todo_reminder_logs`
- `notification_templates`
- `notification_outbox`
- `notification_delivery_logs`

所有业务数据保存在 PostgreSQL。浏览器本地缓存只用于表单草稿，不作为正式业务数据源。

`receivable_orders` 中保留退税归档字段：
- `taxArchived`
- `taxArchivedAt`
- `taxArchivedBy`
- `taxSubmittedAt`
- `taxSubmittedBy`

归档字段只用于日常列表隐藏和档案查询，不删除订单、收款、成本、物流信息或附件。

## 环境变量

腾讯云 CVM 的受保护环境文件需要配置：

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?sslmode=require&uselibpqcompat=true"
APP_URL="https://your-production-domain.example.com"
CRON_SECRET=""
SETTINGS_ENCRYPTION_KEY=""
SETTINGS_ENCRYPTION_KEY_ID="primary-v1"
SETTINGS_ENCRYPTION_PREVIOUS_KEYS=""
BCRYPT_COST="12"
REMINDER_WEBHOOK_URL=""

# 可选：仅用于空数据库引导管理员。生产环境禁止使用 admin@example.com、12345678、admin123456、password。
INITIAL_ADMIN_NAME=""
INITIAL_ADMIN_EMAIL=""
INITIAL_ADMIN_PASSWORD=""

COS_REGION="ap-shanghai"
COS_ENDPOINT="https://cos.ap-shanghai.myqcloud.com"
COS_SECRET_ID="your-cos-secret-id"
COS_SECRET_KEY="your-cos-secret-key"
COS_BUCKET="your-private-bucket-name-with-appid"

# 可选：覆盖系统设置中加密保存的腾讯云短信密钥。
TENCENT_SMS_SECRET_ID=""
TENCENT_SMS_SECRET_KEY=""

RESEND_API_KEY=""
RESEND_FROM=""
RESEND_EMAIL_ENDPOINT=""

UPSTASH_REDIS_REST_URL=""
UPSTASH_REDIS_REST_TOKEN=""
RATE_LIMIT_REDIS_REST_URL=""
RATE_LIMIT_REDIS_REST_TOKEN=""
RATE_LIMIT_NAMESPACE="nextwood"
```

用 `openssl rand -hex 32` 生成 `SETTINGS_ENCRYPTION_KEY`。轮换密钥时先更换
`SETTINGS_ENCRYPTION_KEY_ID`，并把旧密钥以 JSON 对象放入
`SETTINGS_ENCRYPTION_PREVIOUS_KEYS`；系统读取旧配置后会自动用新密钥重加密。

腾讯云短信密钥可在后台系统设置中加密保存；服务器环境中的
`TENCENT_SMS_SECRET_ID`、`TENCENT_SMS_SECRET_KEY` 如已配置，会优先使用且不会回显到页面。

阿里云 OCR / 文档智能默认只允许官方 HTTPS 域名。确需使用自定义域名时，才配置逗号分隔的
`ALIYUN_OCR_ALLOWED_HOSTS`、`ALIYUN_DOCMIND_ENDPOINT_ALLOWED_HOSTS` 或
`ALIYUN_DOCMIND_OUTPUT_ALLOWED_HOSTS`。

另行执行一次 `openssl rand -hex 32` 生成 `CRON_SECRET`，不要与设置加密密钥复用，也不要保留示例占位值。

生产环境 CSP 默认不允许浏览器连接或加载任意外部 `https:` 资源。如确实需要外链资源，例如外部 Logo CDN 或独立 PDF 查看域名，请显式配置白名单：

```text
CSP_CONNECT_SRC=https://api.example.com
CSP_IMG_SRC=https://assets.example.com
CSP_FRAME_SRC=https://viewer.example.com
CSP_MEDIA_SRC=https://media.example.com
```

所有 `/api/*` 业务接口会在统一入口限流，默认值如下，可按正式环境访问量调整：

```text
API_RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_READ_LIMIT=1000
API_RATE_LIMIT_WRITE_LIMIT=300
API_RATE_LIMIT_UPLOAD_LIMIT=60
```

也兼容以下 R2 变量名：

```bash
CLOUDFLARE_R2_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
CLOUDFLARE_R2_BUCKET
R2_ENDPOINT
```

邮件通知使用 Resend：

```text
RESEND_API_KEY=Resend API Key
RESEND_FROM=发件邮箱
RESEND_EMAIL_ENDPOINT=https://api.resend.com/emails
```

`RESEND_EMAIL_ENDPOINT` 可留空，默认使用 Resend 官方接口。若未配置 `RESEND_API_KEY` 或发件邮箱，系统会阻止邮件发送并保存明确失败原因。

统一 API 限流在本地开发时可使用进程内存。生产环境默认必须配置 Upstash Redis：

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

也可使用别名：

```text
RATE_LIMIT_REDIS_REST_URL=
RATE_LIMIT_REDIS_REST_TOKEN=
RATE_LIMIT_NAMESPACE=nextwood
RATE_LIMIT_REDIS_TIMEOUT_MS=1500
API_RATE_LIMIT_MEMORY_MAX_BUCKETS=20000
API_RATE_LIMIT_REGISTRATION_WINDOW_MS=900000
API_RATE_LIMIT_REGISTRATION_LIMIT=5
```

仅当腾讯云 CVM 始终只运行一个 Node 进程（不使用 PM2 cluster、多副本或第二台服务器）时，可以显式选择单实例内存限流：

```text
SINGLE_INSTANCE_MEMORY_RATE_LIMIT=true
```

只要增加进程、实例或扩容，就必须先改用 Redis 并删除该开关。任何多进程、多实例或无服务器生产环境都不得使用此开关。

腾讯云 CVM 通过 Nginx 等反向代理运行时，还应配置：

```text
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_PROVIDER=
```

只有当应用端口不直接暴露公网，且反向代理会覆盖 `X-Real-IP`、追加 `X-Forwarded-For` 时才能启用。否则客户端可以伪造来源地址，导致限流和审计记录失真。若使用 Cloudflare 作为可信入口，则改为 `TRUSTED_PROXY_PROVIDER=cloudflare`，并只允许 Cloudflare 回源访问。

### 文件服务器配置

PDF 单证和供应商资料必须保存到私有对象存储，不能保存到应用服务器本地目录。腾讯云服务器推荐配置 COS：

```text
COS_REGION=存储桶地域，例如 ap-shanghai
COS_ENDPOINT=地域访问端点，例如 https://cos.ap-shanghai.myqcloud.com
COS_SECRET_ID=专用 CAM 子用户 SecretId
COS_SECRET_KEY=专用 CAM 子用户 SecretKey
COS_BUCKET=包含 APPID 的完整存储桶名称
```

存储桶必须保持私有读写，应用通过服务端鉴权提供上传、预览和下载。旧部署仍兼容以下 Cloudflare R2 / S3 配置：

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_ENDPOINT=
```

配置完成后，以管理员登录系统，访问：

```text
/api/storage/health
```

返回 `ok: true` 表示文件服务器可用。若配置错误，接口会返回明确错误，例如“文件存储服务未配置”“Access Key 错误”“Bucket 不存在”或“网络超时”。

## 定时任务

腾讯云必须用唯一的 systemd timer 或 cron 调度以下路径，频率统一维护在 `config/tencent-cloud-cron.json`：

```text
/api/reminders/run
/api/cron/workbench-overdue-todos
/api/cron/exchange-rates
/api/cron/logistics-invoice-ocr
/api/cron/notification-outbox
/api/cron/freightower-sync
```

汇率任务每天自动拉取汇率并缓存到 `exchange_rates`。所有定时任务都必须携带 `Authorization: Bearer CRON_SECRET`，禁止使用 `change-me` 作为生产密钥。腾讯云只能启用一个调度器，避免相同任务重复执行。

## 默认账号

系统不再提供 `admin@example.com / 12345678` 默认管理员。历史默认账号会在新迁移中被停用，生产环境请使用公司管理员邮箱创建或引导管理员账号。

如果需要空数据库引导管理员，请配置 `INITIAL_ADMIN_EMAIL` 和 `INITIAL_ADMIN_PASSWORD`，并确保不是公开默认值。引导账号首次登录必须修改密码。

## 本地开发

本系统必须通过 Next.js 服务运行，不能只用静态文件服务打开前端文件。如果使用 Python `http.server`、VS Code Live Server 或普通静态服务器，页面即使能显示，`/api/auth/login` 等接口也不可用，登录会提示：

```text
登录接口不可用（501），当前页面可能由静态文件服务打开，请使用 Next.js 本地预览或腾讯云正式网址访问系统。
```

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

如果端口被占用，Next.js 会提示新的可访问端口，请以终端输出为准。

### 本地登录检查

1. 确认 `DATABASE_URL` 指向可用 PostgreSQL 数据库。
2. 确认已运行 `npm run dev`，不是静态文件服务。
3. 打开 Next.js 地址，例如 `http://localhost:3000`。
4. 使用公司管理员或已审核通过账号登录。
5. 如果登录失败，页面会显示明确错误，同时浏览器控制台会输出 `console.error` 便于定位。

## 数据库迁移

开发环境迁移：

```bash
npm run db:migrate
```

生产环境迁移：

```bash
npm run db:deploy
```

普通应用构建只执行：

```bash
prisma generate
next build
```

生产迁移需要独立执行：

```bash
npm run db:deploy
```

数据库迁移必须在上线前单独执行：

```bash
npm run db:deploy
```

Prisma 7 额外约定：

- `prisma/schema.prisma` 只保留 `datasource provider`，连接串配置放在 `prisma.config.ts`
- Prisma Client 生成到 `lib/generated/prisma`
- 服务端数据库入口统一使用 `lib/prisma.js`

Next.js 16 额外约定：

- 根路径请求拦截文件使用 `proxy.js`
- 不再使用 `middleware.js`

## 常用命令

```bash
npm run dev
npm run build:app
npm run verify:ci
npm run verify
npm run audit
npm run build
npm run start
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:studio
```

## 部署说明

当前生产环境只部署到腾讯云 CVM，以 Nginx + systemd 运行 Next.js；数据库使用腾讯云 PostgreSQL，附件使用腾讯云 COS 私有桶。Vercel 发布配置已经移除，不作为当前发布或验收依据。GitHub 是代码和正式版本的唯一档案库，每个上线版本都必须保存 commit、Git tag 和 GitHub Release。

安全发布顺序：

1. 只选择本次功能文件提交并推送到 GitHub `main`，禁止在脏工作区宽泛暂存。
2. 确认该 commit 的 GitHub Actions 已通过，为本次正式版本创建并推送 `vX.Y.Z` Git tag；`GitHub Release Archive` workflow 会自动创建 GitHub Release。
3. CVM 从 GitHub 拉取并检出同一 tag 或 commit SHA，然后执行 `npm ci`。
4. 如果存在数据库 migration，先确认数据库备份成功并核对 migration 状态。数据库备份属于业务数据保护，不是代码版本备份。
5. 只有存在待执行 migration 时，才在维护窗口显式执行：

```bash
npm run db:deploy
```

6. 使用 `npm run build:app` 构建应用；普通构建不会自动迁移数据库。
7. 重启唯一的应用服务。腾讯云不保留源码压缩包、旧 release 目录或代码版本备份；需要回滚时从 GitHub 检出上一个正式 tag 后重新构建。
8. 核对服务器运行 commit 与 GitHub SHA 一致、systemd 服务正常、仅一个 Next.js 运行进程、`www` 返回 200、裸域名正确跳转。
9. 登录后验收报价、销售执行、供应商采购、应收订单、COS 附件和邮件流程。

代码层发布前执行：

```bash
npm run verify:ci
```

`verify:release` 会显式执行生产迁移，只能在数据库已备份、连接目标已核对并处于受保护发布窗口时使用：

```bash
npm run verify:release
```

当前大版本升级迁移（按顺序执行）：

```text
20260816113000_factory_dispatch_sms_outbox
20260816160000_factory_purchase_production_progress
20260816190000_factory_purchase_delivery_quantity_variance
20260816210000_factory_purchase_loading_result
20260819100000_factory_purchase_transition_settlement
```

这些迁移依次增加采购单短信通知、生产进度流水、交付数量差异审批、一柜多供应商和一张采购单跨多柜的装柜总账，以及历史订单过渡结算凭证；供应商结算按已放行实装数量计算，留仓货物不计货款。生产执行前必须先备份并检查 migration 状态，禁止使用 `prisma db push` 替代正式 migration。

### 操作手册与 GitHub 发布说明

系统在左侧导航提供“操作手册”入口。正文由 `app/modules/manual-content.ts` 维护，页面与搜索交互由 `app/modules/ManualModule.tsx` 渲染；报价、销售执行、工厂采购、生产交付、采购结算和原有订单 / 物流 / 退税流程均纳入同一本手册。

当前生产发布以 GitHub 到腾讯云 CVM 的受保护链路为准：

```bash
git status --short
npm run typecheck
npm run lint
npm run verify:ci
git add <本次变更文件>
git commit -m "<清晰描述本次修改>"
git push origin main
```

- 推送到 `main` 只完成代码同步和 GitHub Actions 校验；正式上线前还必须推送 `vX.Y.Z` Git tag，由 GitHub 自动创建 Release，腾讯云再拉取目标版本、构建并重启服务。
- GitHub Actions 的 `CI` workflow 运行 `npm run verify:ci`，不连接或迁移生产数据库，也不直接重启腾讯云服务。
- 如需数据库结构变更，必须在备份后于上线窗口单独执行一次 `npm run db:deploy`；普通构建不会替代生产迁移。
- GitHub 保存全部代码版本；腾讯云只运行当前目标 SHA，不额外保存代码版本副本。回滚代码时从 GitHub 拉取上一个正式 tag。
- 工作区存在无关文件时，只 stage 本次变更文件，避免把临时文档、输出目录或调试文件带入部署 commit。
- 发布完成必须同时验证 GitHub SHA、服务器运行 SHA、服务状态和真实公网页面，不能只以 `git push` 成功作为上线完成。

## 安全注意事项

- 不要将 `.env` 提交到 GitHub。
- 远程 PostgreSQL 必须启用 TLS；禁止使用 `sslmode=disable/allow/prefer`。代理或自签证书环境使用 `sslmode=require&uselibpqcompat=true` 保持加密兼容；具备可信 CA 和匹配域名时优先使用 `sslmode=verify-full`。
- `SETTINGS_ENCRYPTION_KEY` 必须是独立的 32 字节随机密钥，不能与数据库或登录密码复用。
- 不要公开 R2 Access Key 和 Secret Key。
- 上传文件只保存 R2 Key，下载时后端生成短期签名 URL。
- 文件资产统一写入 `file_assets`，用于跨模块预览、下载、软删除和后续文件治理。
- 发送邮件前必须确认收件人配置有效；失败会写入通知日志，不应阻断主业务数据保存。
- 所有新增、编辑、删除、上传、下载和退税状态修改都会记录操作日志。
- 删除订单不直接删除 R2 原始文件，避免退税资料丢失。
- 依赖升级或锁文件变更后，至少执行一次 `npm run audit` 和 `npm run verify`。
