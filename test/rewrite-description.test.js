import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import {
  rewriteAssemblyTools,
  rewriteToolSchema,
  softenPermissionsDescription,
} from '../lib/rewrite-description.js'

// rc.2 官方文案, 取自 @deepseek-ai/dsh-sandbox 的 sandboxPermissionsDescription():
// bash / pwsh 传 command, write / edit 传 operation.
const commandPermissions = 'The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval.'
const operationPermissions = 'The narrowest wider sandbox mode for a one-shot retry of the exact operation the sandbox just denied; the retry asks the user for approval.'

// rc.2 bash 工具 description. 提权说明整段已删, 这里的改写只针对参数描述.
const bashDescription = 'Execute a bash command (`bash -c`) and return its stdout/stderr. '
  + 'Each call runs in a fresh shell; pass `workdir` instead of using `cd`. '
  + 'Managed `$DSH_*` variables expose current harness environment facts. '
  + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
  + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]`, a policy denial: do not retry another way.'

test('permissions description also allows a first-attempt escalation', () => {
  const command = softenPermissionsDescription(commandPermissions)
  assert.notEqual(command, commandPermissions)
  assert.equal(command.includes('on the first attempt'), true)
  const operation = softenPermissionsDescription(operationPermissions)
  assert.notEqual(operation, operationPermissions)
  assert.equal(operation.includes('on the first attempt'), true)
})

test('unrelated parameter descriptions stay untouched', () => {
  assert.equal(softenPermissionsDescription('Timeout in milliseconds.'), 'Timeout in milliseconds.')
  assert.equal(softenPermissionsDescription(''), '')
})

test('rewriteToolSchema keeps unrelated tools and identity', () => {
  const grep = { name: 'grep', description: 'Search file contents.', parameters: {} }
  assert.equal(rewriteToolSchema(grep), grep)
  const clean = {
    name: 'bash',
    description: bashDescription,
    parameters: { type: 'object', properties: {} },
  }
  assert.equal(rewriteToolSchema(clean), clean)
})

test('rewriteAssemblyTools rewrites bash and write permissions, keeps grep', () => {
  const grep = { name: 'grep', description: 'Search file contents.' }
  const bash = {
    name: 'bash',
    description: bashDescription,
    parameters: {
      type: 'object',
      properties: {
        sandbox_permissions: { type: 'string', description: commandPermissions },
      },
    },
  }
  const write = {
    name: 'write',
    description: 'Create or fully replace a UTF-8 text file.',
    parameters: {
      type: 'object',
      properties: {
        sandbox_permissions: { type: 'string', description: operationPermissions },
      },
    },
  }
  const tools = [bash, write, grep]
  const next = rewriteAssemblyTools(tools)
  assert.notEqual(next, tools)
  assert.equal(next[2], grep)
  assert.equal(next[0].description, bashDescription)
  assert.equal(next[0].parameters.properties.sandbox_permissions.description.includes('on the first attempt'), true)
  assert.equal(next[1].parameters.properties.sandbox_permissions.description.includes('on the first attempt'), true)
})

test('apply rewrites assembled bash tools after next()', async () => {
  const events = []
  const ctx = {
    on(name, fn, options) {
      events.push({ name, options })
      this[name] = fn
      return () => {}
    },
    get() {
      return undefined
    },
  }
  apply(ctx)
  assert.deepEqual(events.map((entry) => [entry.name, entry.options]), [
    ['system-prompt/assemble', { prepend: true }],
    ['tools/execute', undefined],
  ])

  const original = {
    name: 'bash',
    description: bashDescription,
    parameters: {
      type: 'object',
      properties: {
        sandbox_permissions: { type: 'string', description: commandPermissions },
      },
    },
  }
  const assembly = { sections: [], contexts: [], tools: [original], variables: {} }
  const result = await ctx['system-prompt/assemble'](assembly, {}, async () => assembly)
  assert.notEqual(result.tools[0], original)
  assert.equal(result.tools[0].description, bashDescription)
  assert.equal(
    result.tools[0].parameters.properties.sandbox_permissions.description.includes('on the first attempt'),
    true,
  )
})
