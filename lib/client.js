// Web Client 半区.
//
// 卡片本身完全交给官方组件渲染, 插件只做两件事:
// 1. 展示前清洗非法提权配对 (逻辑与 lib/sanitize.js 一致, 但不改会话日志原文);
// 2. 在官方卡片外面接上两个 hover 浮层, 复制按钮的 Shift 行为与上游变更提示,
//    并让 run_in_background 的调用也能展开.
window.__ModuleLoader__.load({
  id: 'dsh-valid-bash',
  factory: (require) => {
    const React = require('react')

    // 增强依赖宿主平台模块表里的 react-dom/client 与官方 primitives.
    // 拿不到就退化为 "只清洗参数再转发官方组件", 保证核心功能不受影响.
    function optionalRequire(spec) {
      try {
        return require(spec)
      } catch {
        return undefined
      }
    }

    const ReactDomClient = optionalRequire('react-dom/client')
    const primitives = optionalRequire('@deepseek-ai/dsh-client-ui-primitives')
    const SHELL_ENHANCE_AVAILABLE = primitives !== undefined
      && typeof primitives.TerminalBlock === 'function'
      && typeof primitives.writeClipboard === 'function'
      && ReactDomClient !== undefined

    const SLOT = 'tool.call.toolview'
    const LOCALE = 'conversation'
    const WRAP_PRIORITY = -1
    // 卡片要接管展开行为的 shell 工具.
    const SHELL_TOOL_KEYS = ['bash', 'pwsh']
    // 只做参数清洗并转发官方组件的工具.
    const PASSTHROUGH_TOOL_KEYS = ['write', 'edit']
    // 提示小灰字里附带的插件版本, 与 package.json 的 version 同步,
    // 由单元测试校验.
    const PLUGIN_VERSION = 'v0.1.0'

    // ------------------------------------------------------------------
    // 参数清洗
    // ------------------------------------------------------------------

    function validEscalationFields(args) {
      const permission = args.sandbox_permissions
      const justification = args.justification
      if (permission === undefined && justification === undefined) return true
      if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
      return typeof justification === 'string' && justification.trim() !== ''
    }

    function sanitizeArgs(args) {
      if (validEscalationFields(args)) return args
      const next = { ...args }
      delete next.sandbox_permissions
      delete next.justification
      return next
    }

    function sanitizeArgsRaw(raw) {
      if (typeof raw !== 'string' || raw === '') return raw
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        return raw
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return raw
      const sanitized = sanitizeArgs(value)
      if (sanitized === value) return raw
      return JSON.stringify(sanitized)
    }

    function sanitizeBlock(block) {
      if (block === undefined || block === null || typeof block !== 'object') return block

      let changed = false
      const next = { ...block }

      if (block.call !== undefined && block.call !== null && typeof block.call === 'object') {
        if (typeof block.call.argsRaw === 'string') {
          const argsRaw = sanitizeArgsRaw(block.call.argsRaw)
          if (argsRaw !== block.call.argsRaw) {
            next.call = { ...block.call, argsRaw }
            changed = true
          }
        }
      } else if (typeof block.argsRaw === 'string') {
        const argsRaw = sanitizeArgsRaw(block.argsRaw)
        if (argsRaw !== block.argsRaw) {
          next.argsRaw = argsRaw
          changed = true
        }
      }

      if (Array.isArray(block.subCalls) && block.subCalls.length > 0) {
        const subCalls = block.subCalls.map(sanitizeBlock)
        if (subCalls.some((item, index) => item !== block.subCalls[index])) {
          next.subCalls = subCalls
          changed = true
        }
      }

      return changed ? next : block
    }

    // ------------------------------------------------------------------
    // 纯派生逻辑 (与官方 ui-tool 的判定保持一致)
    // ------------------------------------------------------------------

    /** 取出调用参数原文: 已定局用 call.argsRaw, 流式中用 block.argsRaw. */
    function rawArgsOf(block) {
      if (block === undefined || block === null || typeof block !== 'object') return undefined
      if (block.call !== undefined && block.call !== null && typeof block.call.argsRaw === 'string') {
        return block.call.argsRaw
      }
      return typeof block.argsRaw === 'string' ? block.argsRaw : undefined
    }

    /** 解析成对象参数, 非 JSON 或非对象返回 null. */
    function parsedArgsOf(block) {
      const raw = rawArgsOf(block)
      if (raw === undefined || raw === '') return null
      let value
      try {
        value = JSON.parse(raw)
      } catch {
        return null
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
      return value
    }

    /**
     * 渲染用的 block: 先清洗提权参数, 再去掉 shell 调用的 run_in_background 标记.
     * 官方行靠这个标记把后台调用判成不可展开的通用卡片, 去掉后它才会给出
     * chevron 与展开体 (命令 + ack). 只影响显示, 执行早已完成.
     */
    function displayBlock(block) {
      const sanitized = sanitizeBlock(block)
      const argsRaw = rawArgsOf(sanitized)
      if (argsRaw === undefined) return sanitized
      let value
      try {
        value = JSON.parse(argsRaw)
      } catch {
        return sanitized
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return sanitized
      if (value.run_in_background !== true) return sanitized
      const next = { ...value }
      delete next.run_in_background
      const nextRaw = JSON.stringify(next)
      if (sanitized.call !== undefined && sanitized.call !== null && typeof sanitized.call === 'object') {
        return { ...sanitized, call: { ...sanitized.call, argsRaw: nextRaw } }
      }
      return { ...sanitized, argsRaw: nextRaw }
    }

    /**
     * 判定这个调用能否用自绘卡片渲染, 不能时回退官方组件.
     * 字段校验与官方 shellCall 一致, 另外校验通过后提权字段一律视为合法 (插件已放宽).
     */
    function parseShellCall(args) {
      if (args === null || typeof args !== 'object') return null
      const command = args.command
      const description = args.description
      const workdir = args.workdir
      const timeoutMs = args.timeoutMs
      const background = args.run_in_background
      if (typeof command !== 'string' || command.trim() === '') return null
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) return null
      if (workdir !== undefined && typeof workdir !== 'string') return null
      if (background !== undefined && typeof background !== 'boolean') return null
      if (description !== undefined && typeof description !== 'string') return null

      // 命令之外的原始参数, 供 hover 提示符时以 JSON 展示.
      const extra = {}
      for (const key of Object.keys(args)) {
        if (key === 'command') continue
        extra[key] = args[key]
      }

      return {
        command,
        description: description === undefined || description.trim() === '' ? undefined : description,
        workdir: workdir === undefined || workdir === '' ? undefined : workdir,
        timeoutMs,
        background: background === true,
        extra,
      }
    }

    /** 提示符标签 (与官方一致): 家目录折叠为 ~, 否则取路径末段. */
    function cwdLabel(cwd, home) {
      if (cwd === undefined || cwd === '') return '$'
      const trimmed = cwd.replace(/[/\\]+$/, '')
      if (home !== undefined && home !== '' && trimmed === home.replace(/[/\\]+$/, '')) return '~'
      const segment = trimmed.split(/[/\\]/).pop()
      return segment === undefined || segment === '' ? cwd : segment
    }

    // ------------------------------------------------------------------
    // 样式
    // ------------------------------------------------------------------

    const ROOT_CLASS = 'dvb-shell'
    const STYLE_ID = 'dsh-valid-bash-style'
    // 增强逻辑依赖的官方终端块 DOM 锚点, 由结构探针盯着 (相对卡片根节点查询).
    const SEL_HEADER = '[data-terminal] > div:first-child'
    const SEL_PROMPT = `${SEL_HEADER} > div:first-child`
    const SEL_COMMAND = `${SEL_PROMPT} > div > span:last-child`
    const SEL_OFFICIAL_COPY = `${SEL_HEADER} > button`
    const SEL_OUTPUT = '[data-terminal] > div:last-child'
    // 官方 bash / pwsh 行根节点的标记, 用来把变更提示挂到它末尾.
    const SEL_ROW = '[data-sample="bash"]'

    // 卡片本身完全交给官方组件渲染, 插件只加两个浮层与一条提示.
    const STYLES = `
.dvb-shell { position: relative; }
/* 悬停第一行提示符小块: 浮动展示这次调用除 command 之外的参数 (纯展示, 不参与鼠标事件). */
.dvb-args-tip { position: absolute; z-index: 40; max-width: 420px; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xs-13); white-space: pre-wrap; pointer-events: none; }
/* 悬停命令文本: 浮动展示完整命令, 按原换行展开, 超出限高可在浮层里滚动. */
.dvb-cmd-tip { position: absolute; z-index: 41; max-width: 560px; max-height: 240px; overflow: auto; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-primary); font: var(--dsw-font-markdown-code-block-small); white-space: pre; }
/* 上游变更提示: 挂在官方行末尾的一行小灰字. */
.dvb-notice { flex: none; min-width: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 8px; font-size: 11px; line-height: calc(24px + var(--dsh-content-font-delta, 0px)); color: var(--dsw-alias-label-caption); }
`

    /** 注入插件样式, 幂等; 返回清理函数. */
    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return () => {}
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
      return () => { style.remove() }
    }

    // ------------------------------------------------------------------
    // 上游结构探针
    // ------------------------------------------------------------------

    /**
     * 探针结果:
     * - ok       官方卡片与基线一致;
     * - changed  官方命令列样式变了 (可能已自带横向滚动或命令复制);
     * - mismatch 官方命令列的 DOM 结构变了, 本插件的隐藏选择器可能失效;
     * - failed   探针自身跑不起来, 无从判断.
     */
    let probePromise

    function probeLabels() {
      return {
        signal: (signal) => `killed by ${signal}`,
        exitCode: (code) => `exit code ${code}`,
        noExitCode: 'no exit code',
        running: 'running',
        failed: 'failed',
        done: 'done',
        copy: 'copy',
        copied: 'copied',
        noOutput: 'no output',
        collapseAria: 'collapse output',
        collapse: 'collapse',
        expandAria: (hidden) => `expand ${hidden} more lines`,
        expand: (hidden) => `expand ${hidden} more lines`,
      }
    }

    /**
     * 量一份离屏渲染的官方卡片.
     * 检查本插件接入所依赖的锚点是否仍能定位: 命令行, 命令文本, 官方复制按钮, 输出区, 以及行根节点.
     */
    function inspectProbe(container) {
      const fail = (status, detail) => ({ status, detail })
      if (container.querySelector('[data-terminal]') === null) return fail('mismatch', 'block')
      const header = container.querySelector(SEL_HEADER)
      if (header === null) return fail('mismatch', 'header')
      const prompt = container.querySelector(SEL_PROMPT)
      if (prompt === null) return fail('mismatch', 'prompt')
      if (container.querySelector(SEL_COMMAND) === null) return fail('mismatch', 'command')
      const officialCopy = container.querySelector(SEL_OFFICIAL_COPY)
      if (officialCopy === null) return fail('mismatch', 'officialCopy')
      if (container.querySelector(SEL_OUTPUT) === null) return fail('mismatch', 'output')
      if (container.querySelector(SEL_ROW) === null) return fail('mismatch', 'row')
      // 官方那颗复制按钮要留在原位可见 (点击由官方处理, Shift+点击由插件接住).
      if (window.getComputedStyle(officialCopy).display === 'none') return fail('changed', 'officialCopy')
      // 接入的东西是否都到位.
      if (container.querySelector('.dvb-args-tip') === null) return fail('mismatch', 'argsTip')
      if (container.querySelector('.dvb-cmd-tip') === null) return fail('mismatch', 'commandTip')
      if (container.querySelector('.dvb-notice') === null) return fail('mismatch', 'notice')
      return { status: 'ok' }
    }

    /**
     * 跑一次结构探针并缓存结果 (一个页面会话只跑一次).
     * 只用于决定是否显示 "上游已变更" 提示, 不改变卡片行为.
     */
    function runStructureProbe() {
      if (probePromise !== undefined) return probePromise
      probePromise = new Promise((resolve) => {
        let container
        let root
        const finish = (result) => {
          try {
            if (root !== undefined) root.unmount()
          } catch {
            // 清理失败不影响探针结论.
          }
          try {
            if (container !== undefined) container.remove()
          } catch {
            // 同上.
          }
          resolve(result)
        }
        try {
          container = document.createElement('div')
          container.className = ROOT_CLASS
          container.style.position = 'fixed'
          container.style.left = '-10000px'
          container.style.top = '0'
          container.style.width = '480px'
          container.style.pointerEvents = 'none'
          document.body.appendChild(container)
          // 官方行根节点用一个同标记的容器代替 (探针渲染的是行里的终端块).
          const rowHost = document.createElement('div')
          rowHost.setAttribute('data-sample', 'bash')
          container.appendChild(rowHost)
          root = ReactDomClient.createRoot(rowHost)
          root.render(React.createElement(primitives.TerminalBlock, {
            command: 'probe-command-line\nprobe-second-line',
            output: 'probe-output\n',
            labels: probeLabels(),
          }))
          // React 18 的 root.render 是异步提交, 等一个宏任务再挂增强并量 DOM.
          window.setTimeout(() => {
            let dispose
            let result
            try {
              // 真跑一遍接入: 探针要确认浮层, 变更提示与按钮接管确实还能挂到官方结构上.
              dispose = enhanceTerminal(container, {
                command: 'probe-command-line\nprobe-second-line',
                argsLabel: '{}',
                cwdLabel: cwdLabel(undefined),
                copyLabel: 'copy',
                copiedLabel: 'copied',
                noticeText: 'probe-notice',
              })
              result = inspectProbe(container)
            } catch {
              result = { status: 'failed' }
            }
            try {
              if (dispose !== undefined) dispose()
            } catch {
              // 清理失败不影响探针结论.
            }
            finish(result)
          }, 0)
        } catch {
          finish({ status: 'failed' })
        }
      })
      return probePromise
    }

    /** 探针结论对应的提示文案, 无提示时返回 undefined. */
    function probeNotice(status) {
      if (status === 'ok' || status === 'pending' || status === undefined) return undefined
      if (status === 'failed') {
        return `无法校验官方卡片实现, 卡片增强可能已失效 (${PLUGIN_VERSION})`
      }
      return `官方卡片已变更, 卡片增强可能已过时, 请检查插件更新 (${PLUGIN_VERSION})`
    }

    // ------------------------------------------------------------------
    // 卡片接入
    // ------------------------------------------------------------------

    const h = React.createElement
    const COPY_FEEDBACK_MS = 1000

    /** locale 取词, key 缺失或返回 key 本身时退化为兜底文案. */
    function pickLabel(t, key, fallback, vars) {
      if (typeof t === 'function') {
        try {
          const value = vars === undefined ? t(key) : t(key, vars)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch {
          // 退化为兜底文案.
        }
      }
      return fallback
    }

    /**
     * 等官方卡片 (展开后的终端块) 出现在容器里, 再接上插件要的东西.
     * 卡片默认是折叠的, 接入代码不能在挂载时就假定它已经渲染出来.
     */
    function enhanceTerminal(root, options) {
      let teardown = null
      const attach = () => {
        if (teardown !== null) return
        if (root.querySelector('[data-terminal]') === null) return
        teardown = attachTerminal(root, options)
      }
      const observer = new MutationObserver(attach)
      observer.observe(root, { childList: true, subtree: true })
      attach()
      return () => {
        observer.disconnect()
        if (teardown !== null) teardown()
      }
    }

    /**
     * 把插件要的东西接到官方卡片上, 卡片本身仍由官方组件渲染:
     * 1. 悬停第一行提示符小块 -> 参数浮层;
     * 2. 悬停命令文本 -> 完整命令浮层 (浮层里可滚动);
     * 3. 官方那颗复制按钮原样保留 (点击仍由官方自己复制输出), 只在按住 Shift 点击时改复制完整命令;
     * 4. 上游变更提示挂在官方行末尾.
     * 官方组件重渲染会丢掉外部插入的节点, 所以用 MutationObserver 维持.
     */
    function attachTerminal(root, options) {

      const argsTip = document.createElement('div')
      argsTip.className = 'dvb-args-tip'
      argsTip.textContent = options.argsLabel
      argsTip.hidden = true

      const commandTip = document.createElement('div')
      commandTip.className = 'dvb-cmd-tip'
      commandTip.textContent = options.command
      commandTip.hidden = true

      root.append(argsTip, commandTip)

      /** 浮层贴住触发元素的下沿, 并且不跑到卡片左边之外. */
      const placeTip = (tip, target) => {
        const rootRect = root.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        tip.hidden = false
        tip.style.left = `${Math.max(0, targetRect.left - rootRect.left)}px`
        tip.style.top = `${targetRect.bottom - rootRect.top}px`
      }

      const hideArgsTip = () => { argsTip.hidden = true }
      const onPromptEnter = (event) => {
        commandTip.hidden = true
        placeTip(argsTip, event.currentTarget)
      }

      let hideTimer
      const cancelHideCommand = () => {
        if (hideTimer === undefined) return
        window.clearTimeout(hideTimer)
        hideTimer = undefined
      }
      // 命令浮层可滚动, 所以指针移出命令文本后留一点时间给它移进浮层.
      const scheduleHideCommand = () => {
        cancelHideCommand()
        hideTimer = window.setTimeout(() => { commandTip.hidden = true }, 160)
      }
      commandTip.addEventListener('mouseenter', cancelHideCommand)
      commandTip.addEventListener('mouseleave', () => { commandTip.hidden = true })

      // 命令文本的悬停用委托: 多行命令每行都有一个命令 span.
      const onRootOver = (event) => {
        const target = event.target
        if (!(target instanceof Element) || !target.matches(SEL_COMMAND)) return
        cancelHideCommand()
        argsTip.hidden = true
        placeTip(commandTip, target)
      }
      const onRootOut = (event) => {
        const target = event.target
        if (!(target instanceof Element) || !target.matches(SEL_COMMAND)) return
        scheduleHideCommand()
      }
      root.addEventListener('mouseover', onRootOver)
      root.addEventListener('mouseout', onRootOut)

      /** 第一行里文本等于提示符标签的那个 span 才是提示符本身. */
      const findPromptTarget = () => {
        const prompt = root.querySelector(SEL_PROMPT)
        if (prompt === null) return undefined
        const firstLine = [...prompt.children].find((child) => child.tagName === 'DIV')
        if (firstLine === undefined) return undefined
        return [...firstLine.children].find((el) => (
          el.tagName === 'SPAN' && el.textContent.trim() === options.cwdLabel
        ))
      }

      let promptTarget
      const bindPromptTarget = () => {
        const target = findPromptTarget()
        if (target === promptTarget) return
        if (promptTarget !== undefined) {
          promptTarget.removeEventListener('mouseenter', onPromptEnter)
          promptTarget.removeEventListener('mouseleave', hideArgsTip)
        }
        promptTarget = target
        if (promptTarget !== undefined) {
          promptTarget.addEventListener('mouseenter', onPromptEnter)
          promptTarget.addEventListener('mouseleave', hideArgsTip)
        }
      }

      /** 上游变更提示挂在官方行末尾 (行元素带 data-sample 标记). */
      const syncNotice = () => {
        const row = root.querySelector(SEL_ROW)
        if (row === null) return
        const existing = row.querySelector(':scope > .dvb-notice')
        if (options.noticeText === undefined) {
          if (existing !== null) existing.remove()
          return
        }
        if (existing === null) {
          const span = document.createElement('span')
          span.className = 'dvb-notice'
          span.textContent = options.noticeText
          span.title = options.noticeText
          row.appendChild(span)
          return
        }
        if (existing.textContent !== options.noticeText) {
          existing.textContent = options.noticeText
          existing.title = options.noticeText
        }
      }

      let copyTarget
      /** 普通点击放行给官方 (官方自己复制输出); Shift+点击由插件复制完整命令. */
      const onCopyClick = (event) => {
        if (event.shiftKey !== true) return
        event.preventDefault()
        event.stopPropagation()
        const button = event.currentTarget
        void primitives.writeClipboard(options.command).then((ok) => {
          if (!ok) return
          button.textContent = options.copiedLabel
          window.setTimeout(() => { button.textContent = options.copyLabel }, COPY_FEEDBACK_MS)
        })
      }
      const bindCopyButton = () => {
        const button = root.querySelector(SEL_OFFICIAL_COPY)
        if (button === copyTarget) return
        if (copyTarget !== undefined && copyTarget !== null) {
          copyTarget.removeEventListener('click', onCopyClick, true)
        }
        copyTarget = button
        if (copyTarget !== null) copyTarget.addEventListener('click', onCopyClick, true)
      }

      const sync = () => {
        bindPromptTarget()
        bindCopyButton()
        syncNotice()
      }

      sync()
      const observer = new MutationObserver(sync)
      observer.observe(root, { childList: true, subtree: true })

      return () => {
        observer.disconnect()
        cancelHideCommand()
        root.removeEventListener('mouseover', onRootOver)
        root.removeEventListener('mouseout', onRootOut)
        if (promptTarget !== undefined) {
          promptTarget.removeEventListener('mouseenter', onPromptEnter)
          promptTarget.removeEventListener('mouseleave', hideArgsTip)
        }
        if (copyTarget !== undefined && copyTarget !== null) {
          copyTarget.removeEventListener('click', onCopyClick, true)
        }
        argsTip.remove()
        commandTip.remove()
      }
    }

    /**
     * bash / pwsh 的 toolview: 卡片本身完全交给官方组件渲染, 插件只在外面套一层容器,
     * 在容器里接上两个浮层, 复制按钮的 Shift 行为与变更提示.
     * 后台调用另见 {@link displayBlock}: 渲染用的参数里去掉 run_in_background,
     * 官方行才会给出展开体 (只影响显示, 执行早已完成).
     */
    function createShellRow(ctx, key) {
      return function ValidBashShellRow(props) {
        const original = findOriginal(ctx, key) ?? (key === 'pwsh' ? findOriginal(ctx, 'bash') : undefined)
        const containerRef = React.useRef(null)
        const [probeStatus, setProbeStatus] = React.useState('pending')
        const block = React.useMemo(() => displayBlock(props.block), [props.block])
        const sessionCwd = props.useSessions((list) => list.byId[props.sessionId]?.cwd)
        const call = React.useMemo(() => {
          const parsed = parsedArgsOf(props.block)
          return parsed === null ? null : parseShellCall(sanitizeArgs(parsed))
        }, [props.block])
        const notice = probeNotice(probeStatus)
        const copyLabel = pickLabel(props.t, 'copy', '复制')
        const copiedLabel = pickLabel(props.t, 'copied', '复制成功')
        const argsLabel = call === null
          ? undefined
          : (Object.keys(call.extra).length === 0 ? '无其它参数' : JSON.stringify(call.extra, null, 2))

        React.useEffect(() => {
          let alive = true
          void runStructureProbe().then((result) => {
            if (alive) setProbeStatus(result.status)
          })
          return () => { alive = false }
        }, [])

        // 官方卡片挂载后 (以及它每次重渲染后) 维持插进去的浮层与提示.
        React.useLayoutEffect(() => {
          const root = containerRef.current
          if (root === null || call === null || argsLabel === undefined) return undefined
          return enhanceTerminal(root, {
            command: call.command,
            argsLabel,
            cwdLabel: cwdLabel(call.workdir ?? sessionCwd),
            copyLabel,
            copiedLabel,
            noticeText: notice,
          })
        }, [call, argsLabel, sessionCwd, copyLabel, copiedLabel, notice])

        if (original === undefined) return null
        return h('div', { className: ROOT_CLASS, ref: containerRef },
          h(original.component, { ...props, block }),
        )
      }
    }

    // ------------------------------------------------------------------
    // 注册
    // ------------------------------------------------------------------

    function findOriginal(ctx, key) {
      return ctx.slots.entries(SLOT).find((entry) => (
        entry.options.key === key && (entry.options.priority ?? 0) === 0
      ))
    }

    /** write / edit 走的转发: 清洗参数后交给官方组件. */
    function createPassthrough(ctx, key) {
      return function ValidBashPassthroughRow(props) {
        const block = React.useMemo(() => sanitizeBlock(props.block), [props.block])
        const original = findOriginal(ctx, key) ?? (key === 'pwsh' ? findOriginal(ctx, 'bash') : undefined)
        if (original === undefined) return null
        return React.createElement(original.component, { ...props, block })
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (SHELL_ENHANCE_AVAILABLE) {
          const dispose = installStyles()
          if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-valid-bash: styles')
        }
        ctx.slots.inject(SLOT, function* () {
          for (const key of SHELL_TOOL_KEYS) {
            const component = SHELL_ENHANCE_AVAILABLE
              ? createShellRow(ctx, key)
              : createPassthrough(ctx, key)
            yield ctx.slots.register(
              {
                name: SLOT,
                key,
                priority: WRAP_PRIORITY,
                locale: LOCALE,
                registrant: 'dsh-valid-bash',
              },
              component,
            )
          }
          for (const key of PASSTHROUGH_TOOL_KEYS) {
            yield ctx.slots.register(
              {
                name: SLOT,
                key,
                priority: WRAP_PRIORITY,
                locale: LOCALE,
                registrant: 'dsh-valid-bash',
              },
              createPassthrough(ctx, key),
            )
          }
        })
      },
      // 单元测试入口: 只暴露纯逻辑, 运行时不依赖.
      __internals: {
        PLUGIN_VERSION,
        SHELL_ENHANCE_AVAILABLE,
        SEL_HEADER,
        SEL_PROMPT,
        SEL_COMMAND,
        SEL_OFFICIAL_COPY,
        SEL_OUTPUT,
        SEL_ROW,
        sanitizeArgs,
        sanitizeArgsRaw,
        sanitizeBlock,
        displayBlock,
        parseShellCall,
        parsedArgsOf,
        cwdLabel,
        probeNotice,
        inspectProbe,
      },
    }
  },
})
