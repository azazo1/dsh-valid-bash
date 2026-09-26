# dsh-valid-bash

放宽 dsh 沙箱提权参数校验的插件, 作用于 bash, pwsh, write, edit 工具. 同时修正 Web 对话里这些工具卡片因非法提权字段而无法展开的问题.

## 解决的问题

dsh 的沙箱工具在收到 `sandbox_permissions` / `justification` 参数时, 会在执行前做两层校验:

1. `justification` 必须是非空字符串, 否则报 `invalid justification: expected a non-empty sentence`.
2. 请求的模式必须严格宽于当前有效模式, 否则报 `sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`.

这两层校验导致一些本可直接执行的调用被拒绝, 例如当前已是 `workspace-write`, 模型却显式传了 `sandbox_permissions: "workspace-write"`.

Web 卡片还有第三层问题: `ui-tool` 的 `validEscalationFields` 用同样的规则判断能否展开. 模型只要带上空 `justification` 或无效的 `sandbox_permissions`, 命令即使已经跑完, bash / pwsh / write / edit 卡片也会保持折叠, 没有 chevron.

## 特性

- 在 `tools/execute` 阶段拦截 bash, pwsh, write, edit 工具的提权参数并归一化.
- 同模式提权请求 (如请求 `workspace-write` 而当前已是 `workspace-write`) 剥离提权参数, 直接以当前模式执行, 不再报错.
- 空 `justification` 不再被拒: 合法升级场景自动补默认说明, 无需升级场景直接剥离参数.
- 合法升级审批不被绕过: 例如 `read-only` 请求 `workspace-write` 仍走正常用户审批流程.
- 沙箱模式无法解析时剥离提权参数, 保证调用继续执行.
- Web Client 在渲染前剥离非法提权配对, 让上述工具卡片可以展开. 不改会话日志原文, 历史会话同样生效.

## 安装

Web 端装进 `web` profile:

```shell
dsh plugin --profile web add azazo1/dsh-valid-bash
```

装完重启 `dsh web`, 浏览器里刷新一次页面.

桌面端装进 `desktop` profile. 它由 Electron 应用独占管理, `dsh plugin` 会拒绝 `--profile desktop`, 所以要用应用内的插件管理器: 在插件页的安装入口填上面命令里对应的包名或本地目录. 装上后重启应用, 窗口刷新一次.

引擎版本线要求 `@deepseek-ai/dsh-*` 不低于 `0.1.7-rc.2`, 且仍在 `0.1.x` 上. 更早的引擎线装不上这个版本.

web 与 desktop 两个 profile 跑的是同一套 Web 应用, 桌面端只是多起一个 Host 子进程并给 `<html>` 打上平台标记, 所以同一份包在两边通用, 不需要分别构建.

## 使用

插件挂载后自动生效, 无需额外配置.

## License

MIT
