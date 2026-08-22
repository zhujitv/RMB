# NEXTWOOD 供应商小程序

这是 RMB 的全新产品供应商移动端，不是已作废的物流跟踪小程序。

第一阶段功能：

- 使用现有 RMB 产品供应商账号登录
- 供应商待办首页
- 工厂采购单查询、详情、价格回填和回复
- 生产进度累计数量填报
- 资料回传任务查询、PDF 选择和上传

## 开发者工具

1. 在微信开发者工具中导入本目录。
2. 在 `project.config.json` 中换成正式小程序 AppID。
3. 正式环境需将 `https://www.nextwood.net` 配置为 request、uploadFile 和 downloadFile 合法域名。
4. 本地调试其它后端时，在开发者工具 Storage 中设置 `supplierMiniApiBaseUrl`。

小程序不保存密码，只在 Storage 中保存服务器签发的会话令牌。
