# RMB CVM 完整部署通道

这条通道用于依赖、数据库、运行配置、部署基础设施或大版本升级。普通 UI 和业务逻辑小更新应改用 [`Deploy CVM Quick`](CVM_QUICK_DEPLOYMENT_CHANNEL.md)：不更新版本号、不上传完整 `.next`，由腾讯云拉取 Git 增量并在候选工作区构建。

## 通道设计

1. GitHub Actions 先解析要发布的 `main` 提交。
2. 默认要求该提交已有成功的 `CI` workflow。
3. GitHub Runner 通过 SSH 读取 CVM 当前运行代码的 Git SHA。
4. Runner 以成功写入的 `.rmb-deployed-sha` 判断实际运行版本；首次使用标记时回退到最近一次成功部署记录，不再把可能已提前快进的 Git HEAD 误当成已上线版本。
5. 无生产权限的 Build job 在干净检出中使用非敏感构建参数生成默认 `.next` 归档；带生产权限的 Deploy job 只下载该归档，并生成从 CVM 当前 SHA 到同一目标 SHA 的 Git bundle。
6. CVM 校验构建归档、依赖契约、Prisma 变更边界和 systemd 运行配置；Deploy job 和 CVM 都不执行 `npm ci`、不构建、不读取 `/srv/rmb/shared/app.env`，也不在普通发布中连接生产数据库。
7. CVM 保留旧源码状态和旧 `.next`，切换源码与新构建后重启 `rmb-app.service`；本机或公网 `/api/health` 未通过时恢复旧源码与旧构建。
8. `/api/health` 会实际执行数据库就绪查询，从而确认 systemd 已把受保护运行配置注入新进程。
9. 全部就绪检查成功后，CVM 才写入 `.rmb-deployed-sha` 并删除临时回滚文件。
10. GitHub Runner 最后再次访问公网 `/api/health`，确认外部网络路径正常。

## 安全边界

- 不使用 Vercel 发布入口。
- 不在普通部署中执行 `npm run db:deploy`、`npm run build:release` 或 `prisma migrate deploy`。
- 普通构建不读取、复制或输出生产环境文件；`RMB_CVM_ENV_FILE` 仅供显式安全迁移与独立备份流程使用。
- 普通原地部署不允许运行依赖发生变化；依赖变化必须使用完整 release 部署，避免在线替换 `node_modules`。
- 如果相对已部署版本存在未批准的 Prisma schema 或 migration 变化，普通部署会直接停止。
- 不允许非快进部署；服务器当前 SHA 必须是目标 SHA 的祖先。
- 同一时间只允许一个生产部署运行；完整通道与 `Deploy CVM Quick` 共用 CVM 上的 `.rmb-production-deploy.lock` 远端锁，也共用 GitHub 的 `rmb-cvm-production` 并发组。
- SSH 必须启用严格主机校验；`RMB_CVM_KNOWN_HOSTS` 必须由人工确认后写入 GitHub Secret。
- 建议使用专用 Linux 用户 `rmb-deploy`，只允许写入 `/srv/rmb/app`，并通过免密 sudo 仅执行 `systemctl restart rmb-app.service`；`show`、`is-active` 和 `status` 均以普通用户只读执行。
- Build job 不绑定 `production` Environment，也不会注入或落盘任何腾讯云 SSH 凭据；SSH 私钥只在 Deploy job 下载并核对构建产物后创建，任务结束即删除。
- 上传到 CVM 的 bundle 是临时文件，远程脚本结束后会删除。

## GitHub 配置

必须配置这些 GitHub Secrets：

```text
RMB_CVM_HOST
RMB_CVM_USER
RMB_CVM_SSH_KEY
RMB_CVM_KNOWN_HOSTS
```

可选配置：

```text
RMB_CVM_PORT          # 默认 22
```

建议配置这些 Repository Variables：

```text
RMB_CVM_APP_DIR=/srv/rmb/app
RMB_CVM_SERVICE=rmb-app.service
RMB_CVM_ENV_FILE=/srv/rmb/shared/app.env
RMB_CVM_DB_BACKUP_DIR=/srv/rmb/shared/db-backups
RMB_CVM_DB_BACKUP_RETENTION_DAYS=15
RMB_CVM_LOCAL_HEALTH_URL=http://127.0.0.1:3000/
RMB_CVM_PUBLIC_HEALTH_URL=https://www.nextwood.net
RMB_CVM_AUTO_DEPLOY=false
```

实际默认值：

- `RMB_CVM_APP_DIR` 未配置时使用 `/srv/rmb/app`
- `RMB_CVM_SERVICE` 未配置时使用 `rmb-app.service`
- `RMB_CVM_ENV_FILE` 未配置时使用 `/srv/rmb/shared/app.env`
- `RMB_CVM_DB_BACKUP_DIR` 未配置时使用 `/srv/rmb/shared/db-backups`
- `RMB_CVM_DB_BACKUP_RETENTION_DAYS` 未配置时使用 `15`
- `RMB_CVM_LOCAL_HEALTH_URL` 未配置时使用 `http://127.0.0.1:3000/`
- `RMB_CVM_PUBLIC_HEALTH_URL` 未配置时使用 `https://www.nextwood.net`

部署用户的 sudoers 至少需要允许实际 `systemctl` 路径对应的重启命令，例如：

```text
rmb-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart rmb-app.service
```

可先在 CVM 上用 `command -v systemctl` 确认路径；部署会在切换源码和构建前以无交互方式核验这条权限。

## 手动部署

在 GitHub Actions 页面运行 `Deploy CVM` workflow，`ref` 默认填 `main`。

命令行触发：

```bash
gh workflow run deploy-cvm.yml --repo zhujitv/RMB -f ref=main -f require_ci_success=true
```

查看结果：

```bash
gh run list --repo zhujitv/RMB --workflow deploy-cvm.yml --limit 3
```

## 自动部署

默认不会在每次 CI 成功后自动部署。要打开自动部署，设置 Repository Variable：

```text
RMB_CVM_AUTO_DEPLOY=true
```

打开后，`main` 分支的 `CI` workflow 成功完成时，`Deploy CVM` 会自动发布同一个提交。

## 数据库迁移

如果本次代码包含 Prisma migration，普通部署不会读取生产数据库，也不会执行或检查迁移状态。应先完成数据库备份，再在维护窗口显式执行：

```bash
npm run db:deploy
```

迁移完成后，再运行 `Deploy CVM`。

### 单条安全过渡迁移

如果线上库存在历史待迁移，但本次代码只需要先补一条已审核的安全迁移，手动运行 `Deploy CVM` 时可填写 `safe_prisma_migration`，值为已提交的 Prisma migration 目录名，例如：

```bash
gh workflow run deploy-cvm.yml --repo zhujitv/RMB \
  -f ref=main \
  -f require_ci_success=true \
  -f safe_prisma_migration=20260820233000_customer_product_material_code
```

工作流会在 CVM 上：

1. 读取 `/srv/rmb/shared/app.env` 中的生产 `DATABASE_URL`。
   如果部署账号不能直接读取该受保护文件，迁移脚本会优先从当前 `rmb-app.service` 进程环境读取；如果服务器允许对应的无交互 `sudo` 读取，也可使用该后备路径。两种方式都不修改文件权限，也不把连接串输出到 GitHub 日志。
2. 自动确保 `/srv/rmb/shared/db-backups` 可写；如果共享备份目录不可写，则停止迁移，避免备份散落到部署用户私人目录。
3. 自动清理备份目录中超过 15 天的 RMB 数据库备份；可用 `RMB_CVM_DB_BACKUP_RETENTION_DAYS` 调整。
4. 用与数据库大版本匹配的 PostgreSQL 工具做 `pg_dump` 备份，并兼容 Prisma 专用连接参数。
5. 只执行指定 migration 的 `migration.sql`。
6. 只把这一条 Prisma migration 标记为已应用。
7. 继续执行正常 CVM 部署。

`safe_prisma_migration` 默认空，不会运行任何数据库迁移。这个通道只适合已人工确认的单条安全迁移；复杂迁移仍应单独制定维护窗口。

## 数据库备份策略

生产服务器应安装独立的每日逻辑备份任务，避免只有部署或迁移时才生成备份。仓库内提供可重复执行的安装脚本：

```bash
sudo bash scripts/install-cvm-db-backup-strategy.sh
```

安装后的策略：

1. 备份目录固定为 `/srv/rmb/shared/db-backups`。
2. 目录权限为 `700`，默认归属 `rmb-deploy:rmb-deploy`。
3. 每天 03:20 左右执行一次，带 `20m` 随机延迟，服务为 `rmb-db-backup.service`，定时器为 `rmb-db-backup.timer`。
4. 每次备份生成 `rmb-db-YYYYMMDDTHHMMSSZ.dump`。
5. 自动删除超过 15 天的 RMB 数据库备份文件。
6. 备份脚本会优先使用 PostgreSQL 18 的 `pg_dump`，并把 Prisma 连接串拆成 `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD`、`PGDATABASE`，避免 `schema`、`useLibPQCompat` 等应用参数污染 `pg_dump`。

可覆盖参数：

```text
RMB_DB_BACKUP_USER=rmb-deploy
RMB_DB_BACKUP_GROUP=rmb-deploy
RMB_ENV_FILE=/srv/rmb/shared/app.env
RMB_DB_BACKUP_DIR=/srv/rmb/shared/db-backups
RMB_DB_BACKUP_RETENTION_DAYS=15
RMB_RUN_BACKUP_NOW=true
```

检查命令：

```bash
systemctl is-enabled rmb-db-backup.timer
systemctl is-active rmb-db-backup.timer
systemctl list-timers rmb-db-backup.timer --no-pager
find /srv/rmb/shared/db-backups -maxdepth 1 -type f -name 'rmb-db-*.dump' -printf '%TY-%Tm-%Td %TH:%TM %s bytes %p\n' | sort | tail -5
```
