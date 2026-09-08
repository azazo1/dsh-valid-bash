import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib/client.js'), 'utf8')

function loadPlugin() {
  /** @type {Array<{ id: string, factory: Function }>} */
  const registrations = []
  vm.runInNewContext(source, {
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

function mount(plugin, originals = []) {
  const reactCalls = []
  const pluginExports = plugin.factory((id) => {
    if (id !== 'react') throw new Error(`unexpected require: ${id}`)
    return {
      useMemo: (fn) => fn(),
      createElement: (type, props) => {
        reactCalls.push({ type, props })
        return { type, props }
      },
    }
  })

  const slotRegs = []
  const ctx = {
    slots: {
      inject(name, callback) {
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
})

test('bash wrapper forwards a sanitized block to the original row', () => {
  const seen = []
  const original = {
    options: { key: 'bash', priority: 0 },
    component: (props) => {
      seen.push(props)
      return props
    },
  }
  const plugin = loadPlugin()
  const { slotRegs, reactCalls } = mount(plugin, [original])
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')
  const block = {
    callId: 'c1',
    name: 'bash',
    argsRaw: JSON.stringify({
      command: 'pwd',
      description: 'print cwd',
      justification: '',
      sandbox_permissions: 'workspace-write',
      timeoutMs: 10000,
    }),
    subCalls: [],
  }

  bash.component({ toolName: 'bash', block, extra: true })
  assert.equal(reactCalls.length, 1)
  assert.equal(reactCalls[0].type, original.component)
  assert.equal(reactCalls[0].props.extra, true)
  assert.deepEqual(JSON.parse(reactCalls[0].props.block.argsRaw), {
    command: 'pwd',
    description: 'print cwd',
    timeoutMs: 10000,
  })
  assert.equal(seen.length, 0)
})

test('pwsh wrapper reuses the bash row when pwsh has no original', () => {
  const original = {
    options: { key: 'bash', priority: 0 },
    component: (props) => props,
  }
  const plugin = loadPlugin()
  const { slotRegs, reactCalls } = mount(plugin, [original])
  const pwsh = slotRegs.find((entry) => entry.options.key === 'pwsh')
  pwsh.component({
    toolName: 'pwsh',
    block: {
      callId: 'c1',
      name: 'pwsh',
      argsRaw: '{"command":"Get-Location","description":"cwd","sandbox_permissions":"workspace-write","justification":""}',
      subCalls: [],
    },
  })
  assert.equal(reactCalls[0].type, original.component)
  assert.deepEqual(JSON.parse(reactCalls[0].props.block.argsRaw), {
    command: 'Get-Location',
    description: 'cwd',
  })
})

test('wrapper returns null when the original row is missing', () => {
  const plugin = loadPlugin()
  const { slotRegs, reactCalls } = mount(plugin, [])
  const bash = slotRegs.find((entry) => entry.options.key === 'bash')
  assert.equal(bash.component({ block: { argsRaw: '{}' } }), null)
  assert.equal(reactCalls.length, 0)
})

test('wrapper keeps a valid escalation pair untouched', () => {
  const original = {
    options: { key: 'write', priority: 0 },
    component: (props) => props,
  }
  const plugin = loadPlugin()
  const { slotRegs, reactCalls } = mount(plugin, [original])
  const write = slotRegs.find((entry) => entry.options.key === 'write')
  const block = {
    callId: 'c1',
    name: 'write',
    argsRaw: JSON.stringify({
      file_path: '/tmp/work/a.txt',
      content: 'hi',
      sandbox_permissions: 'workspace-write',
      justification: 'Write generated output',
    }),
    subCalls: [],
  }
  write.component({ toolName: 'write', block })
  assert.equal(reactCalls[0].props.block, block)
})
