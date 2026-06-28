# creator-builder 的独立性与 Git 归属

这份文档回答一个常被问到的问题：`creator-builder/` 这个目录能不能脱离外层项目单独存在？

一句话结论：**代码层面它完全自包含、可以单独启动；但它没有自己的 `.git`，所有提交都落进外层那个仓库（外层本身又是 `agora-mvp` 的一个 git worktree）。**

---

## 1. 代码层面：完全自包含，可独立启动

`creator-builder/` 是一个独立的 pnpm monorepo（package 名 `@cb/root`），运行时不依赖外层目录里的任何东西。证据如下。

| 维度       | 实际情况                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| 包与依赖   | 自带 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`node_modules`，依赖全部在目录内解析。 |
| 工作区范围 | `pnpm-workspace.yaml` 只圈定自己的子目录（`packages/*`、`apps/*`、`db`、`infra`、`scripts`），不向上引用外层。 |
| TypeScript | `tsconfig.json` 的项目引用只指向 `./packages/shared`、`./apps/api`、`./apps/web`，没有任何路径逃出本目录。 |
| 源码 import | `apps/web/src` 里的相对路径（例如 `../../../components`）最深也只回到 `apps/web/src` 内部，没有一条引用爬到外层。 |
| 容器构建   | `infra/docker-compose.yml` 的构建上下文是 `context: ..`（compose 文件在 `infra/` 下，所以这里的 `..` 指的是 creator-builder 根，而不是外层项目），Dockerfile 也都在 `infra/` 内。 |
| 配置       | 自带 `.env`、`.env.local.example`、`.env.compose.example`、`.nvmrc`、`eslint.config.js`、`tsconfig.base.json`。 |

全目录搜索也确认：没有任何代码或配置引用外层那些遗留文件（`loop-server.mjs`、`anchor.html`、`miniapp.html` 等老 agora-mvp 脚本）。

**怎么独立跑**：本地子集开发与 Compose 起全栈的完整命令都在本目录的 [`README.md`](../README.md)（「安装」「本地开发」「Compose 起全栈」三节），这里不重复。要点是所有命令都从 creator-builder 根目录执行，不需要切到外层。

---

## 2. Git 层面：跟着外层仓库走，外层又是个 worktree

代码独立，但版本管理不独立——而且比直觉多一层。

- `creator-builder/` 目录里**没有** `.git`。在它里面执行任何 git 命令，都会落到外层目录 `agora-mvp-creator-builder/`。
- 外层目录的 `.git` 是一个**文件**（不是目录），内容是 `gitdir: /Users/danielxing/repos/agora-mvp/.git/worktrees/agora-mvp-creator-builder`。也就是说，外层目录本身是 **`agora-mvp` 仓库的一个 linked worktree**，当前检出在分支 `feat/creator-builder-mainflow`。

所以一次提交的真实归属是这样的：在 creator-builder 里 commit，改动会进入 `repos/agora-mvp` 这个真正的仓库，落在该 worktree 当前的分支上。creator-builder 目录下的文件都作为 `creator-builder/...` 路径被这个仓库跟踪。

路径关系：

```
/Users/danielxing/repos/agora-mvp/                    ← 真正的 Git 仓库（.git 在这里）
/Users/danielxing/repos/agora-mvp-creator-builder/    ← agora-mvp 的一个 worktree（.git 是指向上面的文件）
    ├── creator-builder/                              ← 自包含的 monorepo，无独立 .git
    └── （loop-server.mjs / anchor.html 等外层遗留脚本）
```

---

## 3. 一个要留意的坑：搬走目录会丢历史

正因为 `.git` 不在 `creator-builder/` 内，如果把这个目录**物理拷贝或移动到别处**当作独立项目，它会**丢掉全部 Git 历史**（新位置没有 `.git`），需要重新 `git init`。

- 在原地开发、构建、起容器：没有任何问题，目录自包含。
- 想把它真正剥离成一个独立仓库：先在新位置 `git init`，再决定是否用 `git filter-repo` 之类把历史从 `agora-mvp` 中按 `creator-builder/` 子路径迁出。这是一次性的工程动作，不是日常流程。

---

## 4. 自己复核结论的命令

```bash
# 确认 Git 根落在外层、且外层是 worktree
git rev-parse --show-toplevel        # → .../agora-mvp-creator-builder
cat ../.git                          # → gitdir: .../agora-mvp/.git/worktrees/...

# 确认没有引用爬出本目录（应只返回目录内部的相对路径）
grep -rn "loop-server\|anchor.html\|miniapp" . --exclude-dir=node_modules

# 确认工作区只圈自己的子目录
cat pnpm-workspace.yaml
```
