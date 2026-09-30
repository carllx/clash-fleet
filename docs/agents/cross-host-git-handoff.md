# Cross-Host Git Handoff Discipline

跨主机（macOS 与 Windows）及多 Agent 协作时的 Git 交接与分支治理规范。

---

## 1. 核心原则：远端权威 (Remote Authority)

- **远程 GitHub 引用为唯一交接权威**：任何未推送到 GitHub 远端的本地变更（unpushed commits / dirty tree），对另一台主机而言均视为**不存在**。
- **绝不假设对端状态**：绝对不能假定另一台电脑的本地克隆（local clone）是当前最新状态。
- **基于固定 SHA 交接**：任务交付与跨端接力必须以具体的 Commit SHA 作为验证依据。

---

## 2. 工作开始前规范 (Start of Work)

任何 Agent 在开始执行任务前，必须按顺序执行预检：

1. **获取最新远端状态**：
   ```bash
   git fetch origin
   ```
2. **确认基准引用与固定 SHA**：
   - 明确当前任务的基准分支（如 `origin/main`）或特定的上游提交 SHA；
   - 验证本地基准与远程权威完全一致。
3. **检查本地工作树清洁度**：
   ```bash
   git status
   ```
   - 工作树必须处于干净状态（clean working tree），无未提交修改，无未跟踪文件；
   - 严禁在脏工作树上盲目拉取或切换分支。
4. **新建独立工作分支**：
   - 从经核验的远端权威引用（如 `origin/main`）创建专用的任务分支；
   - 避免直接在本地旧分支上盲目累加提交。

---

## 3. 分支所有权纪律 (Branch Ownership)

- **一任务一分支**：每个独立的工作单元（调研、门禁验证、功能开发、治理修复）必须使用独立命名的特性/修复分支。
- **严禁跨端并发修改同一分支**：macOS 与 Windows 主机严禁在未经协同确认的情况下，对同一个活跃特性分支进行并发编辑与推送，避免分支交叉与冲突。
- **原型与主线隔离**：原型探测分支（如 `prototype/*`）与主线规范分支分立，严禁整包（wholesale）直接并入主线。

---

## 4. 工作结束与交付 (End of Work)

工作单元完成后，必须完成闭环交付动作：

1. **规范提交 (Commit)**：
   - 遵循语义化 Commit 规范，清晰记录改动动机与证据引用。
2. **推送至远端 (Push)**：
   ```bash
   git push origin <branch-name>
   ```
3. **返回固定 SHA**：
   - 交付物必须明确提供已推送到远端的固定提交哈希（Fixed Pushed SHA），作为任务完成的确凿物证。

---

## 5. 跨机接手规范 (Cross-Host Handoff Protocol)

当一台主机需要承接另一台主机产出的工作结果（或合流已通过评审的原型成果）时：

1. **显式拉取远端引用**：
   ```bash
   git fetch origin
   ```
2. **验证对端提交 SHA**：
   - 通过 `git rev-parse origin/<remote-branch>` 校验提交哈希是否与对端交接给出的 SHA 精确匹配；
   - 不匹配时立即暂停并核对，绝不擅自使用陈旧引用。
3. **基于远程权威提取或演进**：
   - 若为规范收敛：仅挑选提取已通过评审的持久化文档（Durable Artifacts），不整包合并原型实现；
   - 若为协同延续：从远程最新已推送提交检出或快进。

---

## 6. 共享治理文档的跨端生效机制 (Canonical Shared Docs)

项目中的全局治理与规范文件：
- `AGENTS.md`
- `docs/agents/*`
- 核心架构与规格文档（如 `docs/research/*`、`docs/adr/*`、`CONTEXT.md`）

**生效规则**：
- 此类文件仅在**合并进入远端主线权威历史 (`origin/main`)**，且各端主机分别执行 fetch/pull 之后，才真正构成跨端生效的全局约束。
- 同步主线更新时，优先推荐快进合并：
  ```bash
  git pull --ff-only origin main
  ```
- 绝对禁止在工作树不干净的情况下执行无条件的盲目 `git pull`。
