import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import {
  HARD_ESCALATION_PARAGRAPH,
  rewriteAssemblyTools,
  rewriteToolSchema,
  softenDescription,
  softenPermissionsDescription,
} from '../lib/rewrite-description.js'

const bashDescription = `Execute a bash command (\`bash -c\`) and return its stdout/stderr. ${HARD_ESCALATION_PARAGRAPH}`
const commandPermissions = 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.'
const operationPermissions = 'The wider sandbox mode this file operation needs. Only valid as a one-shot retry of an operation the sandbox just denied; requires justification and user approval.'

test('bash-like description no longer forbids upfront escalation', () => {
  const next = softenDescription(bashDescription)
  assert.notEqual(next, bashDescription)
  assert.equal(next.includes('Never escalate speculatively'), false)
  assert.equal(next.includes('the one sanctioned exception'), false)
  assert.equal(next.includes('on the first attempt'), true)
})

test('permissions description no longer requires a prior denial', () => {
  assert.equal(softenPermissionsDescription(commandPermissions).includes('one-shot retry'), false)
  assert.equal(softenPermissionsDescription(operationPermissions).includes('one-shot retry'), false)
  assert.equal(softenPermissionsDescription(commandPermissions).includes('on the first attempt'), true)
})

test('rewriteToolSchema keeps unrelated tools and identity', () => {
  const grep = { name: 'grep', description: HARD_ESCALATION_PARAGRAPH, parameters: {} }
  assert.equal(rewriteToolSchema(grep), grep)
  const clean = {
    name: 'bash',
    description: 'Execute a bash command.',
    parameters: { type: 'object', properties: {} },
  }
  assert.equal(rewriteToolSchema(clean), clean)
})

test('rewriteAssemblyTools rewrites bash and write, keeps grep', () => {
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
  assert.equal(next[0].description.includes('Never escalate speculatively'), false)
  assert.equal(next[1].parameters.properties.sandbox_permissions.description.includes('one-shot retry'), false)
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
  assert.equal(result.tools[0].description.includes('Never escalate speculatively'), false)
  assert.equal(
    result.tools[0].parameters.properties.sandbox_permissions.description.includes('one-shot retry'),
    false,
  )
})
