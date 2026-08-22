# dsh-valid-bash

放宽 dsh 沙箱提权参数校验的插件, 作用于 bash, pwsh, write, edit 工具.

## 解决的问题

dsh 的沙箱工具在收到 `sandbox_permissions` / `justification` 参数时, 会在执行前做两层校验:

1. `justification` 必须是非空字符串, 否则报 `invalid justification: expected a non-empty sentence`.
2. 请求的模式必须严格宽于当前有效模式, 否则报 `sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`.

这两层校验导致一些本可直接执行的调用被拒绝, 例如当前已是 `workspace-write`, 模型却显式传了 `sandbox_permissions: "workspace-write"`.

## 特性

- 在 `tools/execute` 阶段拦截 bash, pwsh, write, edit 工具的提权参数并归一化.
- 同模式提权请求 (如请求 `workspace-write` 而当前已是 `workspace-write`) 剥离提权参数, 直接以当前模式执行, 不再报错.
- 空 `justification` 不再被拒: 合法升级场景自动补默认说明, 无需升级场景直接剥离参数.
- 合法升级审批不被绕过: 例如 `read-only` 请求 `workspace-write` 仍走正常用户审批流程.
- 沙箱模式无法解析时剥离提权参数, 保证调用继续执行.

## 安装

通过 dsh profile bundle 以 github archive 方式安装:

```shell
dsh plugin --profile web add "https://github.com/azazo1/dsh-valid-bash/archive/refs/tags/v0.1.0.tar.gz"
```

> bundle 在 harness 启动时挂载, 安装后需重启 dsh 才会生效.

## 使用

插件挂载后自动生效, 无需额外配置.

## License

MIT
