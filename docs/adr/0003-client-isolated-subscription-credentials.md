# 0003. 订阅凭证客户端隔离与无中心化分流

用户机场订阅包含敏感 URL、Token 与个人凭据，在开源与公共协作模式下严禁上传至远程代码仓库；我们决定 V1 不自建订阅转发服务，也不强依赖 Sub-Store 中间件，而是将订阅凭据与拉取严格隔离在客户端本地 CVR Profile 中，Fleet 仅在运行时对 CVR 传入的生效节点列表执行内存级规范化与组装。

## Status

Accepted

## Considered Options

- **自建订阅聚合转换服务 / 远端 GitHub Actions 加密拉取**：需要维护云端服务或将凭据托管在 CI Secrets，增加了服务可用性依赖与凭据外泄攻击面。
- **引入 Sub-Store 作为强制依赖**：Sub-Store 需常驻独立 Node/Docker 服务或复杂的本地环境，大幅提高了轻量 CLI 工具链的安装门槛。
- **客户端本地隔离 (Client-Isolated Boundary)**：订阅凭据与定时拉取完全由本地 CVR GUI 保留；Fleet 发布的脚本仅在 CVR 组装配置的流水线末端（Enhance 阶段）以纯函数方式接收 `config.proxies` 并进行清洗、重命名与策略组挂载。

## Consequences

- 公共代码仓库绝不接触任何机场密钥与凭证，最小化敏感凭据暴露面；
- 工具链保持纯粹的客户端无服务器架构，无额外长期运行开销；
- 若本地存在私有自定义节点或内网域名，停留在本地端通过 CVR 本地规则或本地扩展缝隙独立挂载，绝不修改亦不破坏 Canonical 发布构件的校验和一致性。
