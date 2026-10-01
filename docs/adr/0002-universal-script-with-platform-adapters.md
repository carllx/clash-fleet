# 0002. 单一通用扩展脚本与宿主部署适配器

macOS 与 Windows 在网络路由意图、策略拓扑和分流规则上完全一致，但在文件路径、特权控制、进程名称（`*.app` vs `*.exe`）及生命周期调度上存在差异；我们决定保持跨平台分流核心（Shared Core）统一，发布唯一的通用构建产物 `Script.js`，而将系统差异隔离在数据声明与宿主部署适配器（Platform Adapter）中。

## Status

Accepted

## Considered Options

- **针对双平台分别编译两套独立脚本 (`Script-darwin.js`, `Script-win32.js`)**：增加了 CI 产物矩阵与客户端拉取匹配复杂度，且造成分流核心逻辑的认知分裂。
- **运行时系统动态探测**：在 `Script.js` 内部调用环境探测。然而 Boa 沙箱缺乏 Node.js `process.platform` 等系统环境接口。
- **单一通用脚本 + 声明式进程数据 + 宿主部署适配器**：Shared Core 完全统一；平台专有的进程规则作为声明式数据合并进同一构件，利用 Mihomo 对不存在进程天然静默穿透的特性；安装路径与生命周期重载由各平台 Deployment Adapter 独立承担。

## Consequences

- 彻底避免在两个操作系统间复制代码与维护两套独立的分流策略；
- 发布构件保持单一与不可变；
- 平台特定行为（如 Windows 提权与 Sidecar 重启、macOS Helper Tool 模式）全部收敛在客户端部署器内处理。
