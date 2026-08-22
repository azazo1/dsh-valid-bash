# dsh-valid-bash

放宽 dsh 沙箱提权参数校验的插件, 作用于 bash, pwsh, write, edit 工具.

## 解决的问题

dsh 的沙箱工具在收到 `sandbox_permissions` / `justification` 参数时, 会在执行前做两层校验:

1. `justification` 必须是非空字符串, 否则报 `invalid justification: expected a non-empty sentence`.
2. 请求的模式必须严格宽于当前有效模式, 否则报 `sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`.

这两层校验导致一些本可直接执行的调用被拒绝, 例如当前已是 `workspace-write`, 模型却显式传了 `sandbox_permissions: "workspace-write"`.

## 行为

插件在 `tools/execute` 阶段拦截带提权参数的工具调用, 并按以下规则归一化:

- 请求的模式严格宽于当前有效模式 (合法升级): 保留提权审批流程; 若 `justification` 缺失或为空, 自动补默认说明.
- 请求的模式并不更宽 (同模式或更窄): 剥离 `sandbox_permissions` 与 `justification`, 调用直接以当前模式正常执行.
- 只有 `justification` 没有 `sandbox_permissions`: 剥离 `justification`.
- 沙箱模式无法解析 (例如无沙箱组合): 剥离提权参数, 保证调用继续执行.

合法升级 (例如 `read-only` 请求 `workspace-write`) 仍会走正常的用户审批, 插件不绕过审批.

## 安装

通过 dsh profile bundle 以本地路径方式安装:

```shell
dsh plugin --profile web add "file:/Users/azazo1/pjs/dsh-plugins/dsh-valid-bash"
```

> bundle 在 harness 启动时挂载, 安装后需重启 dsh 才会生效.

## License

MIT
