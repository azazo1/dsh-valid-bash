# dsh-valid-bash

放宽 dsh 沙箱提权参数校验的插件, 作用于 bash, pwsh, write, edit 工具. 同时给 Web 对话里的 bash / pwsh 卡片补上两个 hover 浮层与复制按钮的 Shift 行为, 并让后台调用也能展开.

## 解决的问题

dsh 的沙箱工具在收到 `sandbox_permissions` / `justification` 参数时, 会在执行前做两层校验:

1. `justification` 必须是非空字符串, 否则报 `invalid justification: expected a non-empty sentence`.
2. 请求的模式必须严格宽于当前有效模式, 否则报 `sandbox escalation to "<mode>" is not strictly wider than this call's current "<mode>" mode`.

这两层校验导致一些本可直接执行的调用被拒绝, 例如当前已是 `workspace-write`, 模型却显式传了 `sandbox_permissions: "workspace-write"`.

Web 卡片还有第三层问题: `ui-tool` 的 `validEscalationFields` 用同样的规则判断能否展开. 模型只要带上空 `justification` 或无效的 `sandbox_permissions`, 命令即使已经跑完, bash / pwsh / write / edit 卡片也会保持折叠, 没有 chevron.

官方 bash 卡片本身还有两处不便: 长命令会被省略号截断 (命令区没有横向滚动), 命令文本无法复制 (卡片上的复制按钮复制的是输出); 而 `run_in_background` 的调用被判定为通用卡片, 既没有 chevron, 也看不到命令与 job ack.

## 特性

- 在 `tools/execute` 阶段拦截 bash, pwsh, write, edit 工具的提权参数并归一化.
- 同模式提权请求 (如请求 `workspace-write` 而当前已是 `workspace-write`) 剥离提权参数, 直接以当前模式执行, 不再报错.
- 空 `justification` 不再被拒: 合法升级场景自动补默认说明, 无需升级场景直接剥离参数.
- 合法升级审批不被绕过: 例如 `read-only` 请求 `workspace-write` 仍走正常用户审批流程.
- 沙箱模式无法解析时剥离提权参数, 保证调用继续执行.
- 放宽模型看到的 bash / pwsh 提权说明: 官方文案只承认"被沙箱拒绝之后的一次性重试", 插件改为已知需要更宽权限时第一次也可以直接带 `sandbox_permissions`, 并补一段独立段落说明, 不必先花一轮做注定失败的试探.
- Web Client 在渲染前剥离非法提权配对, 让上述工具卡片可以展开. 不改会话日志原文, 历史会话同样生效.

### bash / pwsh 卡片

卡片本身完全由官方组件渲染, 插件只在它上面接三件事:

- 悬停第一行的提示符小块: 浮出这次调用除 `command` 之外的参数 (JSON), 方便核对 `workdir` / `timeoutMs` / `run_in_background` 等.
- 悬停命令文本: 浮出按原始换行展开的完整命令, 命令很长时在浮层里滚动查看.
- 复制按钮仍是官方那颗 (位置与观感都不变): 点击由官方复制输出, 按住 Shift 点击改复制完整命令.
- `run_in_background` 的调用也能展开: 渲染时去掉这个标记 (只影响显示, 不影响执行), 官方行就会照常给出展开体, 里面是命令行与 job ack 文本. job 的后续输出仍通过 `job_output` 读取.
- write / edit 卡片保持官方实现, 只有参数清洗生效.

### 上游变更提示

卡片挂载时会跑一次结构探针: 离屏渲染一个官方终端块, 在它身上真跑一遍插件接入 (两个浮层, 变更提示, 接住官方按钮), 并确认这些接入点仍然落在官方结构里 (命令行, 命令文本, 官方复制按钮, 输出区, 行根节点). 结果缓存一次, 供所有卡片共用.

官方实现与插件基线不一致, 或探针本身跑不起来时, 卡片标题行末尾会出现一行小灰字提示, 两类情况文案不同, 并附上插件版本. 提示只影响显示, 不改变卡片行为.

如果宿主的平台模块表里没有 `react-dom` 或 `@deepseek-ai/dsh-client-ui-primitives`, 插件自动退化为"只清洗参数再转发官方卡片", 参数清洗不受影响.

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
