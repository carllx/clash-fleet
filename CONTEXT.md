# Clash Fleet

Clash Fleet 是用于 Clash Verge Rev / Mihomo 的多设备配置分发、部署与诊断工具链。

## Language

### 构件与源码模型 (Artifacts & Source)

**Generated Script**:
由构建流水线确定性编译、校验生成的单一扩展脚本文本，作为交付给 CVR 执行的只读构件。
_Avoid_: User script, runtime config, source script

**Build Artifact**:
通过确定性构建和校验后产出的版本化交付物，具备确定性的 SHA-256 校验和，并通过不可变性门禁保护。
_Avoid_: Code, release package, profile

**Shared Core**:
跨操作系统平台完全一致的分流策略、策略组拓扑、服务声明与规则集引用。
_Avoid_: Common config, global rules

**Platform Adapter**:
处理特定宿主操作系统环境（如文件路径、权限探测、生命周期触发与特定进程规则）的适配层。
_Avoid_: OS script, client app

**Rule Asset Provenance**:
对 Fleet 所依赖外部规则数据集的来源、不可变修订或动态依赖属性的显式溯源定义。
_Avoid_: Rule version, rule source

**Pinned Rule Asset**:
绑定不可变版本修订（Git Commit SHA 或固定 Release 资产）的外部规则集，具备确定性与可重现规则资产回滚语义。
_Avoid_: Static rule, fixed provider

**Dynamic External Dependency**:
显式指向动态可变上游（如 HEAD 分支）的外部规则依赖，其回滚语义在清单中标记为局部/不可完全重现 (partial / non-fully-reproducible)。
_Avoid_: Live rule, upstream sync


### 策略组拓扑 (Policy Topology)

**Policy Topology**:
策略组的分层装配结构，按需划分为业务意图层、调度优选层与物理地区池。
_Avoid_: Group tree, proxy chain

**Tier 1 (Business Intent)**:
直接面向业务场景的分流策略组，用于规则绑定与用户手动干预入口。
_Avoid_: Main group, app group

**Tier 1.5 (Scheduling)**:
按需存在、仅引用物理地区池组名进行自动健康优选或调度的元策略组。
_Avoid_: Auto group, test group

**Tier 2 (Region Pool)**:
绑定特定地理区域真实物理代理节点并执行单点健康探测的基础策略组。
_Avoid_: Node group, country group

### 部署与生命周期 (Deployment & Lifecycle)

**Deployment Transaction**:
包含拉取、预检、备份、写入与多维校验的原子部署过程，用于将 Build Artifact 安全交付至目标宿主。
_Avoid_: Update script, sync process, restart sequence

**Runtime Verification**:
变更触发后，通过只读观测内核运行态、规则装载与策略组结构，对业务网络意图后置条件执行的证据验证。
_Avoid_: Health check, ping test, process survival check

**Change Operation**:
一次由唯一 Operation ID 标识、围绕 Change Intent、Logical Target、证据收集、状态对账与恢复所管理的策略变更全生命周期。
_Avoid_: Config update, script edit, patch run

**Logical Target**:
Fleet 能够稳定识别并绑定的一项 CVR/Fleet 配置业务实体，与底层文件路径、运行时 PID 等瞬态事实解耦。
_Avoid_: Target path, config file, process target

**Reconciliation**:
在动作发生或结果未知后，基于逻辑目标源码摘要与内核实际运行态证据，重新确定真实激活状态的过程。
_Avoid_: Polling, health probe, sync check

**Recovery Snapshot**:
变更发生前捕获的只读源文件不可变证据，用于对账失配时的恢复参考；不自动等同于已知良好配置。
_Avoid_: Backup file, current config, auto rollback point
