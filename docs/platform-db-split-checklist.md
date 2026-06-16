# `lib/platform-db.js` 拆分实施清单

## 本轮已完成

- `lib/platform-db.js` 保持为统一导出入口，对业务侧引用路径无侵入。
- 六个一级模块已完成首轮目录级拆分，统一保留聚合入口。
- 其中 `logistics`、`costs`、`tax-profit` 已基本收敛到聚合器 + 领域子文件形态：
  - `lib/platform/shared.js` -> 14 个领域子文件
  - `lib/platform/masters.js` -> 客户/供应商/访问控制子文件
  - `lib/platform/orders-payments.js` -> 订单/收款/访问控制子文件
  - `lib/platform/costs.js` -> `cost-records.js` + `logistics-expenses.js`
  - `lib/platform/logistics.js` -> 国内物流/单证/通知/报关识别子文件
  - `lib/platform/tax-profit.js` -> 退税/利润/审计日志子文件
- 目标是先把正式目录中的超大文件拆成稳定边界，再逐步做更深层逻辑内聚，避免一次硬改业务实现。

## 当前模块职责

### `lib/platform/shared.js`
- 全局常量
- 权限与认证
- 通用工具函数
- 分页、金额、日期、错误处理
- 附件、文件名、会话、密码、角色等公共逻辑
- 当前子文件：
  - `shared-constants.js`
  - `shared-permissions.js`
  - `shared-auth.js`
  - `shared-utils.js`
  - `shared-base-utils.js`
  - `shared-audit.js`
  - `shared-permission-data.js`
  - `shared-exchange.js`
  - `shared-serialization.js`
  - `shared-tax.js`
  - `shared-tax-completeness.js`
  - `shared-tax-sync.js`
  - `shared-order-summary.js`
  - `shared-order-calculations.js`
  - `shared-order-serialization-impl.js`
  - `shared-order-relations.js`
  - `shared-admin.js`
  - `shared-access.js`
  - `shared-users.js`
- 当前进度：
  - `shared-base-utils.js` 已承接通用错误、日期、金额、邮箱与基础输入清洗 helper
  - `shared-audit.js` 已承接审计数据脱敏、通用筛选与审计日志写入
  - `shared-permission-data.js` 已承接权限常量、分页 helper 与自定义权限纯计算逻辑
  - `shared-permissions.js` 现承接权限配置装配，对外暴露权限数据与 `getPermissionConfig`
  - `shared-auth.js` 已承接密码 hash、会话、登录限流、当前用户解析与本人改密
  - `shared-utils.js` 现承接付款条款 helper
  - `shared-serialization.js` 已承接客户/供应商/收款/成本/单证/物流信息序列化
  - `shared-exchange.js` 已承接汇率设置、抓取、缓存与报价逻辑
  - `shared-access.js` 已承接权限报错、读写判断、数据范围与定时任务鉴权
  - `shared-users.js` 已承接用户选择器、头像缩写、默认管理员兜底、个人资料与用户 CRUD
  - `shared-admin.js` 的客户范围 helper 已改走 `masters-access.js`
  - `shared-tax.js` 已降为聚合入口；退税完整度与状态同步拆到独立子文件
  - `shared-order-summary.js` 已降为聚合入口；订单汇总、订单序列化与关联 include 拆到独立子文件
  - `shared-core.js` 已移除，`shared.js` 直接聚合真实子模块

### `lib/platform/masters.js`
- 客户资料
- 供应商资料
- 基础主数据维护
- 当前子文件：
  - `customer-masters.js`
  - `supplier-masters.js`
  - `masters-access.js`
- 当前进度：
  - 已将客户/供应商对外主入口函数真正下沉到子文件
  - `masters-access.js` 已承接客户范围、物流供应商范围和订单单证范围判断
  - `masters-core.js` 已移除，`masters.js` 直接聚合真实子模块

### `lib/platform/orders-payments.js`
- 应收订单
- 收款管理
- 订单与收款联动
- 当前子文件：
  - `orders-module.js`
  - `payments-module.js`
  - `order-access.js`
- 当前进度：
  - 已将订单/收款主入口函数真正下沉到子文件
  - `order-access.js` 已承接订单访问范围、成本写入校验和收款前置校验
  - `orders-payments-core.js` 已移除，`orders-payments.js` 直接聚合真实子模块

### `lib/platform/costs.js`
- 成本录入
- 成本校验
- 成本状态与利润基础联动
- 当前子文件：
  - `cost-records.js`
  - `cost-records-shared.js`
  - `cost-records-queries.js`
  - `cost-records-mutations.js`
  - `logistics-expenses.js`
  - `logistics-expense-shared.js`
  - `logistics-expense-access.js`
  - `logistics-expense-invoice.js`
  - `logistics-expense-queries.js`
  - `logistics-expense-workflow.js`
- 当前进度：
  - `cost-records.js` 已降为聚合入口；普通成本拆成共享 helper、查询和变更子文件
  - `logistics-expenses.js` 已降为聚合入口；物流费用拆成共享 helper、查询和审核/开票/付款工作流子文件
  - `costs` 域已不再依赖过渡态 `costs-core.js`

### `lib/platform/logistics.js`
- 物流信息
- 物流资料
- 报关资料
- 物流费用联动
- 当前子文件：
  - `domestic-logistics-ops.js`
  - `domestic-logistics-api.js`
  - `legacy-attachments.js`
  - `order-documents.js`
  - `shipping-documents.js`
  - `customs-recognition.js`
- 当前进度：
  - `domestic-logistics-ops.js` 已承接国内物流共享 helper、序列化和归档范围逻辑
  - `domestic-logistics-api.js` 已承接国内物流列表、保存、删除、更正申请接口实现
  - `legacy-attachments.js` 已承接旧附件接口的范围校验与删除逻辑
  - `order-documents.js` 已承接订单单证列表、上传、删除、下载、预览与读取权限判断
  - `shipping-documents.js` 已承接清关资料邮件通知与手动发送工作流
  - `customs-recognition.js` 已承接报关单识别、重识别与预览识别逻辑
  - `logistics-core.js` 已移除，`logistics.js` 直接聚合真实子模块

### `lib/platform/tax-profit.js`
- 退税资料
- 利润分析
- 提成相关聚合逻辑
- 当前子文件：
  - `tax-refunds.js`
  - `profit-overview.js`
  - `audit-logs.js`
- 当前进度：
  - 已将退税资料、提成结算、利润分析、经营总览等主入口真正下沉到子文件
  - `tax-refunds.js` 已承接退税列表序列化与排序 helper，不再反向依赖已移除的 `logistics-core.js`
  - `audit-logs.js` 已承接审计日志访问范围与分页查询逻辑

## 下一阶段建议

### 第一优先级
- 为 `lib/platform/*` 各模块补本地最小单测或 smoke test。
- 给 `platform-db.js` 增加模块说明，明确这里只做导出聚合。

### 第二优先级
- 继续检查 `shared-constants.js` 内是否还有适合按主题细分的纯常量/文件名 helper。

## 验收标准

- `node --check lib/platform-db.js lib/platform/*.js`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- 现有 API 路由 import `lib/platform-db.js` 不需要改动即可继续工作
