import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib/client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const documentMock = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '', style: {}, remove() {} }),
  head: { appendChild() {} },
}

function loadPlugin() {
  /** @type {Array<{ id: string, factory: Function }>} */
  const registrations = []
  vm.runInNewContext(source, {
    Promise,
    document: documentMock,
    window: {
      __ModuleLoader__: {
        load(registration) {
          registrations.push(registration)
        },
      },
    },
  })
  assert.equal(registrations.length, 1)
  return registrations[0]
}

/** 插件在独立 vm realm 里执行, 深比较前先摊平成当前 realm 的普通对象. */
const plain = (value) => JSON.parse(JSON.stringify(value))

/** 取插件的纯逻辑出口 (只提供 react, 其余平台模块视作缺失). */
function loadInternals() {
  const reactCalls = []
  return loadPlugin().factory((id) => {
    if (id === 'react') return reactMock(reactCalls)
    throw new Error(id)
  }).__internals
}

const reactMock = (reactCalls) => ({
  createElement: (type, props, ...children) => {
    const element = { type, props, children }
    reactCalls.push(element)
    return element
  },
  Fragment: 'Fragment',
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
})

const primitivesMock = {
  TerminalBlock: () => null,
  Tooltip: () => null,
  TextShimmer: () => null,
  IconApiOutlineRegular: () => null,
  IconChevronDownOutlineRegular: () => null,
  IconChevronUpOutlineRegular: () => null,
  IconInspectOutlineRegular: () => null,
  writeClipboard: () => Promise.resolve(true),
}

/**
 * 挂载插件.
 * @param withPrimitives - 是否提供官方 primitives (决定走自绘卡片还是纯转发).
 * @param originals - 官方已注册的同 key 条目.
 */
function mount(plugin, { withPrimitives = true, originals = [] } = {}) {
  const reactCalls = []
  const modules = {
    react: reactMock(reactCalls),
    'react-dom': { flushSync: (fn) => fn() },
    'react-dom/client': { createRoot: () => ({ render() {}, unmount() {} }) },
    '@deepseek-ai/dsh-client-ui-primitives': primitivesMock,
  }
  const pluginExports = plugin.factory((id) => {
    const module = modules[id]
    if (module === undefined || (withPrimitives === false && id !== 'react')) {
      throw new Error(`unexpected require: ${id}`)
    }
    return module
  })

  const slotRegs = []
  const ctx = {
    document: documentMock,
    effect: (callback) => {
      const dispose = callback()
      if (typeof dispose === 'function') dispose()
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'tool.call.toolview')
        const result = callback()
        if (result !== undefined && typeof result[Symbol.iterator] === 'function') {
          for (const item of result) void item
        }
      },
      register(options, component) {
        slotRegs.push({ options, component })
        return () => {}
      },
      entries(name) {
        assert.equal(name, 'tool.call.toolview')
        return originals
      },
    },
  }

  pluginExports.apply(ctx)
  return { pluginExports, slotRegs, reactCalls }
}

const originalRow = (key) => ({
  options: { key, priority: 0 },
  component: (props) => props,
})

test('client bundle registers the package id and slots inject', () => {
  const plugin = loadPlugin()
  assert.equal(plugin.id, 'dsh-valid-bash')
  const { pluginExports, slotRegs } = mount(plugin)
  assert.deepEqual([...pluginExports.inject], ['slots'])
  assert.deepEqual(
    slotRegs.map((entry) => [entry.options.key, entry.options.priority, entry.options.locale]),
    [
      ['bash', -1, 'conversation'],
      ['pwsh', -1, 'conversation'],
      ['write', -1, 'conversation'],
      ['edit', -1, 'conversation'],
    ],
  )
  assert.deepEqual(
    slotRegs.map((entry) => entry.component.name),
    [
      'ValidBashShellRow',
      'ValidBashShellRow',
      'ValidBashPassthroughRow',
      'ValidBashPassthroughRow',
    ],
  )
})

test('shell rows fall back to the official row when platform primitives are missing', () => {
  const plugin = loadPlugin()
  const { slotRegs } = mount(plugin, { withPrimitives: false, originals: [originalRow('bash')] })
  for (const entry of slotRegs) assert.equal(entry.component.name, 'ValidBashPassthroughRow')
})

/** 官方 slot 会给组件注入 useSessions, 这里给一个最小实现. */
const shellProps = (overrides) => ({
  toolName: 'bash',
  phase: 'start',
  sessionId: 's1',
  useSessions: (selector) => selector({ byId: { s1: { cwd: '/w/app' } } }),
  ...overrides,
})

test('shell row forwards to the official component inside its own container', () => {
  const plugin = loadPlugin()
  const original = originalRow('bash')
  const { slotRegs, reactCalls } = mount(plugin, { originals: [original] })
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')
  const rendered = bash.component(shellProps({
    block: {
      callId: 'c1',
      name: 'bash',
      argsRaw: JSON.stringify({ command: 'node -v', description: 'check node' }),
    },
  }))
  assert.equal(rendered.type, 'div')
  assert.deepEqual(rendered.props.className, 'dvb-shell')
  assert.equal(reactCalls[0].type, original.component)
})

test('shell row drops run_in_background from the block it forwards, so the official row can expand', () => {
  const plugin = loadPlugin()
  const original = originalRow('bash')
  const { slotRegs, reactCalls } = mount(plugin, { originals: [original] })
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')
  bash.component(shellProps({
    block: {
      callId: 'c1',
      name: 'bash',
      argsRaw: JSON.stringify({ command: 'node job.js', description: 'background', run_in_background: true }),
    },
  }))
  const forwarded = reactCalls[0]
  assert.equal(forwarded.type, original.component)
  assert.deepEqual(JSON.parse(forwarded.props.block.argsRaw), { command: 'node job.js', description: 'background' })
})

test('shell row still forwards while preparing or on malformed args', () => {
  const plugin = loadPlugin()
  const original = originalRow('bash')
  const { slotRegs, reactCalls } = mount(plugin, { originals: [original] })
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')

  bash.component(shellProps({ phase: 'preparing', block: { callId: 'c1', argsRaw: '{"command":"node -v"}' } }))
  bash.component(shellProps({
    block: { callId: 'c2', name: 'bash', argsRaw: JSON.stringify({ command: '' }) },
  }))
  assert.equal(reactCalls[0].type, original.component)
  assert.equal(reactCalls[2].type, original.component)
})

test('pwsh row reuses the official bash row when pwsh has no original', () => {
  const plugin = loadPlugin()
  const original = originalRow('bash')
  const { slotRegs, reactCalls } = mount(plugin, { originals: [original] })
  const pwsh = slotRegs.find((entry) => entry.options.key === 'pwsh')
  pwsh.component(shellProps({
    toolName: 'pwsh',
    phase: 'preparing',
    block: { callId: 'c1', argsRaw: '{"command":"Get-Location"}' },
  }))
  assert.equal(reactCalls[0].type, original.component)
})

test('passthrough rows sanitize an illegal escalation pair and forward the block', () => {
  const plugin = loadPlugin()
  const original = originalRow('write')
  const { slotRegs, reactCalls } = mount(plugin, { originals: [original] })
  const write = slotRegs.find((entry) => entry.options.key === 'write')
  const block = {
    callId: 'c1',
    name: 'write',
    argsRaw: JSON.stringify({
      file_path: '/tmp/work/a.txt',
      content: 'hi',
      justification: '',
      sandbox_permissions: 'workspace-write',
    }),
  }
  write.component({ toolName: 'write', block, extra: true })
  assert.equal(reactCalls[0].type, original.component)
  assert.equal(reactCalls[0].props.extra, true)
  assert.deepEqual(JSON.parse(reactCalls[0].props.block.argsRaw), {
    file_path: '/tmp/work/a.txt',
    content: 'hi',
  })
})

test('wrapper returns null when the original row is missing', () => {
  const plugin = loadPlugin()
  const { slotRegs, reactCalls } = mount(plugin, { originals: [] })
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')
  assert.equal(bash.component(shellProps({ block: { callId: 'c1', argsRaw: '{}' } })), null)
  assert.equal(reactCalls.length, 0)
})

test('PLUGIN_VERSION stays in sync with the package version', () => {
  assert.equal(loadInternals().PLUGIN_VERSION, `v${pkg.version}`)
  assert.match(source, new RegExp(`const PLUGIN_VERSION = 'v${pkg.version.replace(/\./g, '\\.')}'`))
})

test('parseShellCall separates the command from the other args shown in the hover bubble', () => {
  const __internals = loadInternals()
  const call = __internals.parseShellCall({
    command: 'node script.js\nnode other.js',
    description: 'run scripts',
    workdir: 'packages/a',
    timeoutMs: 5000,
    run_in_background: true,
    sandbox_permissions: 'danger-full-access',
    justification: 'needs write access',
  })
  assert.equal(call.command, 'node script.js\nnode other.js')
  assert.equal(call.description, 'run scripts')
  assert.equal(call.workdir, 'packages/a')
  assert.equal(call.background, true)
  assert.deepEqual(plain(call.extra), {
    description: 'run scripts',
    workdir: 'packages/a',
    timeoutMs: 5000,
    run_in_background: true,
    sandbox_permissions: 'danger-full-access',
    justification: 'needs write access',
  })

  assert.equal(__internals.parseShellCall({ command: '   ' }), null)
  assert.equal(__internals.parseShellCall({ command: 'ls', run_in_background: 'yes' }), null)
  assert.equal(__internals.parseShellCall({ command: 'ls', timeoutMs: 0 }), null)
  assert.equal(__internals.parseShellCall({ command: 'ls', workdir: 7 }), null)
})

test('displayBlock sanitizes the escalation pair and drops only the background marker', () => {
  const __internals = loadInternals()
  const settled = {
    callId: 'c1',
    name: 'bash',
    argsRaw: JSON.stringify({
      command: 'node job.js',
      description: 'background',
      run_in_background: true,
      justification: '',
      sandbox_permissions: 'workspace-write',
      timeoutMs: 1000,
    }),
  }
  assert.deepEqual(plain(JSON.parse(__internals.displayBlock(settled).argsRaw)), {
    command: 'node job.js',
    description: 'background',
    timeoutMs: 1000,
  })

  const running = {
    callId: 'c2',
    argsRaw: JSON.stringify({ command: 'node job.js', run_in_background: true }),
  }
  assert.deepEqual(plain(JSON.parse(__internals.displayBlock(running).argsRaw)), { command: 'node job.js' })

  // 前台调用与坏参数原样放行.
  const foreground = {
    callId: 'c3',
    name: 'bash',
    argsRaw: JSON.stringify({ command: 'node -v', description: 'check' }),
  }
  assert.equal(__internals.displayBlock(foreground), foreground)
  const broken = { callId: 'c4', argsRaw: 'not json' }
  assert.equal(__internals.displayBlock(broken), broken)
})

test('cwdLabel derives the prompt label the official terminal block renders', () => {
  const __internals = loadInternals()
  assert.equal(__internals.cwdLabel('/Users/me/pjs/dsh-plugins/dsh-valid-bash'), 'dsh-valid-bash')
  assert.equal(__internals.cwdLabel('C:\\work\\demo'), 'demo')
  assert.equal(__internals.cwdLabel('/Users/me', '/Users/me'), '~')
  assert.equal(__internals.cwdLabel(undefined), '$')
})

test('probeNotice names the plugin version and distinguishes a broken probe', () => {
  const __internals = loadInternals()
  assert.equal(__internals.probeNotice('ok'), undefined)
  assert.equal(__internals.probeNotice('pending'), undefined)
  assert.match(__internals.probeNotice('changed'), /请检查插件更新 \(v\d+\.\d+\.\d+\)$/)
  assert.match(__internals.probeNotice('mismatch'), /请检查插件更新 \(v\d+\.\d+\.\d+\)$/)
  assert.match(__internals.probeNotice('failed'), /无法校验官方卡片实现/)
})
