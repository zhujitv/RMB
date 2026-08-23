# 腾讯云小更新快速部署通道

`Deploy CVM Quick` 用于不涉及依赖、数据库和运行配置的小更新。它不修改版本号，也不上传 `.next` 或完整业务源码包。GitHub Runner 只上传一个很小的 bootstrap 脚本；腾讯云现有 Git 仓库自行 fetch 当前 `main` 的精确提交，并在服务器本地完成候选构建。

## 日常使用

1. 代码合并到 `main`，等待同一提交的 `CI` 成功。
2. 打开 GitHub Actions 的 `Deploy CVM Quick`。
3. 直接点击 `Run workflow`；`ref` 保持默认 `main` 即可。
4. 如需复核目标，可填当前 `main` 的完整 40 位 SHA。历史 SHA、分支和 tag 都不会被快速通道接受。

工作流最终仍把目标解析成精确 SHA，并在 GitHub Runner 和腾讯云上分别确认它就是最新 `main`，因此默认值不会降低提交锁定强度。

## 自动安全边界

快速通道只接受线上 SHA 的快进更新，并要求：

- 目标提交已经通过同一 SHA 的完整 CI；
- 腾讯云源码 HEAD、`.next/RMB_DEPLOY_SHA` 和 `.rmb-deployed-sha` 三者一致；
- 最多变更 60 个文件、总计 5000 行，且没有二进制差异或空白错误；
- 依赖清单和锁文件、Prisma 与 migration、环境文件及新增运行时环境变量、GitHub workflow、部署与维护脚本、Next/TypeScript/构建配置、systemd/容器配置、健康检查、认证和定时任务没有变化；
- 首次自举时，仅允许新增本快速 workflow 和本快速部署脚本；后续修改它们必须使用完整部署通道；
- 腾讯云 `origin` 必须固定指向 `zhujitv/RMB`，并能使用服务器已有的只读凭据非交互拉取。

任何一项不满足都会在切换前停止，并提示改用 `Deploy CVM` 完整通道。

## 快速但不跳过保护

腾讯云使用临时 Git worktree 构建目标提交并复用当前 `node_modules`，因此依赖不变时不再执行 `npm ci`。候选 worktree 会按固定顺序执行：安全环境检查、`prisma generate` 生成与当前 schema 一致的 Prisma Client、`next build`。这里的 `prisma generate` 只生成客户端代码，既不连接生产数据库，也不执行 migration；Prisma schema 或 migration 文件有变化时，快速通道会在构建前停止。

构建前会检查服务器资源：可用内存至少 `3072 MiB`；可用磁盘至少 `2 GiB`，且不得低于当前 `.next` 大小的四倍；一分钟负载不得超过安全阈值。构建把 Node.js 堆限制为 `1024 MiB`、把 Next.js 构建并发限制为 1，并使用 `nice` 降低 CPU 优先级；系统具备 `ionice` 时同时降低磁盘 I/O 优先级。服务器端部署进程统一受 22 分钟超时监督，并预留 3 分钟强制结束窗口，整个 GitHub Actions 任务最长 35 分钟。

GitHub 和服务器各有部署锁，快速通道与完整通道使用同一把服务器生产部署锁。候选 `.next` 构建完成后，Linux `renameat2` 会在同一文件系统内原子交换新旧 `.next`，随后重启服务。本机和公网 `/api/health` 都返回目标 SHA 后，系统才快进源码并写入 `.rmb-deployed-sha`；这是一条带服务重启的快速发布流程，不应描述为零停机发布。

交换前后阶段会写入持久状态文件。任务异常退出时会立即尝试自动回滚，恢复旧 `.next`、源码和 marker；即使进程或 SSH 意外中断，下一次快速部署也会先读取该状态并自动完成恢复或收尾。自动恢复无法确认安全状态时会停止并保留候选目录，等待人工处理。

## 审计

GitHub Actions 保留操作者、目标 SHA 和完整日志。服务器同时追加 JSONL 审计记录，默认位置：

```text
/srv/rmb/app/.rmb-quick-deploy-audit.jsonl
```

可用仓库变量 `RMB_CVM_QUICK_AUDIT_FILE` 指定共享审计目录。两条部署通道固定使用应用目录下的 `.rmb-production-deploy.lock`，不可分别配置，避免并发保护失效。审计记录包含线上 SHA、目标 SHA、操作者、Actions 运行链接、变更文件以及成功、失败和回滚状态，不包含环境变量或密钥。

## 服务器前置条件

- `/srv/rmb/app` 是干净的 Git 工作区，`origin` 是获准的 GitHub 仓库；
- 服务器已有 GitHub 只读 deploy key 或等价的只读拉取权限，SSH 使用严格主机校验；
- 当前 `node_modules` 与线上依赖清单一致，并包含可执行的 Prisma 与 Next.js 构建工具；
- 已安装 `git`、`node`、`curl`、`flock`、`timeout`、`python3` 和 `systemctl`；Linux/glibc 必须支持 `renameat2` 原子目录交换；
- 构建开始时至少有 `3072 MiB` 可用内存，并满足动态磁盘和负载门槛；`ionice` 为可选优化；
- 部署用户仍只拥有重启 `rmb-app.service` 所需的免密 sudo 权限。

首次加入这条通道的提交可以通过快速通道自举，但前提是该提交除运行时代码外只新增本 workflow、部署脚本、测试与本说明。若线上 Git 仓库尚未配置只读拉取凭据，应先配置凭据，或用现有完整部署通道完成第一次上线。
