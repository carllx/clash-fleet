# Clash Fleet

Clash Fleet 是用于 Clash Verge Rev / Mihomo 的多设备配置分发、部署与诊断工具链。

## Language

### 构件与源码模型 (Artifacts & Source)

**Generated Script**:
由构建流水线确定性编译、校验生成的单一扩展脚本文本，作为交付给 CVR 执行的只读构件。
_Avoid_: User script, runtime config, source script

**Build Artifact**:
通过确定性构建和校验后产出的不可变版本化交付物，具备唯一的 SHA-256 校验和。
_Avoid_: Code, release package, profile

**Shared Core**:
跨操作系统平台完全一致的分流策略、策略组拓扑、服务声明与规则集引用。
_Avoid_: Common config, global rules

**Platform Adapter**:
处理特定宿主操作系统环境（如文件路径、权限探测、生命周期触发与特定进程规则）的适配层。
_Avoid_: OS script, client app

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
包含拉取、预检、备份、写入、生命周期触发、多维运行时验证与失败自愈回滚的原子部署流水线。
_Avoid_: Update script, sync process

**Runtime Verification**:
部署触发后对 CVR/Mihomo 进程存活、API 响应、生成配置的不变量结构以及网络连通性执行的综合验证。
_Avoid_: Health check, ping test
