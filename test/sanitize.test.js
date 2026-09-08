import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeArgs, sanitizeArgsRaw, sanitizeBlock, validEscalationFields } from '../lib/sanitize.js'

test('omitted escalation pair stays valid', () => {
  const args = { command: 'pwd', description: 'print cwd' }
  assert.equal(validEscalationFields(args), true)
  assert.equal(sanitizeArgs(args), args)
})

test('real upgrade with justification stays valid', () => {
  const args = {
    command: 'git init',
    description: 'init repo',
    sandbox_permissions: 'danger-full-access',
    justification: 'Need unrestricted git metadata writes',
  }
  assert.equal(validEscalationFields(args), true)
  assert.equal(sanitizeArgs(args), args)
})

test('empty justification with workspace-write is stripped', () => {
  const args = {
    command: 'pwd',
    description: 'print cwd',
    justification: '',
    run_in_background: false,
    sandbox_permissions: 'workspace-write',
    timeoutMs: 10000,
    workdir: '/tmp/work',
  }
  assert.equal(validEscalationFields(args), false)
  assert.deepEqual(sanitizeArgs(args), {
    command: 'pwd',
    description: 'print cwd',
    run_in_background: false,
    timeoutMs: 10000,
    workdir: '/tmp/work',
  })
})

test('blank justification and missing justification are stripped', () => {
  assert.deepEqual(
    sanitizeArgs({ command: 'ls', sandbox_permissions: 'workspace-write', justification: ' ' }),
    { command: 'ls' },
  )
  assert.deepEqual(
    sanitizeArgs({ command: 'ls', sandbox_permissions: 'workspace-write' }),
    { command: 'ls' },
  )
})

test('orphan justification and invalid permission are stripped', () => {
  assert.deepEqual(sanitizeArgs({ command: 'ls', justification: 'Need access' }), { command: 'ls' })
  assert.deepEqual(
    sanitizeArgs({ command: 'ls', sandbox_permissions: 'read-only', justification: 'Need access' }),
    { command: 'ls' },
  )
})

test('sanitizeArgsRaw keeps incomplete JSON and identity for valid objects', () => {
  const valid = '{"command":"pwd","description":"print cwd"}'
  assert.equal(sanitizeArgsRaw(valid), valid)
  assert.equal(sanitizeArgsRaw('{'), '{')
  assert.equal(sanitizeArgsRaw('["x"]'), '["x"]')
})

test('sanitizeArgsRaw rewrites the terra-style empty justification payload', () => {
  const raw = JSON.stringify({
    command: 'pwd',
    description: 'print cwd',
    justification: '',
    sandbox_permissions: 'workspace-write',
    timeoutMs: 10000,
  })
  assert.deepEqual(JSON.parse(sanitizeArgsRaw(raw)), {
    command: 'pwd',
    description: 'print cwd',
    timeoutMs: 10000,
  })
})

test('sanitizeBlock rewrites running and settled forms and preserves identity', () => {
  const clean = { callId: 'c1', name: 'bash', argsRaw: '{"command":"pwd","description":"x"}', subCalls: [] }
  assert.equal(sanitizeBlock(clean), clean)

  const running = {
    callId: 'c2',
    name: 'bash',
    argsRaw: '{"command":"pwd","description":"x","sandbox_permissions":"workspace-write","justification":""}',
    subCalls: [],
  }
  const sanitizedRunning = sanitizeBlock(running)
  assert.notEqual(sanitizedRunning, running)
  assert.deepEqual(JSON.parse(sanitizedRunning.argsRaw), { command: 'pwd', description: 'x' })

  const settled = {
    kind: 'tool-result',
    callId: 'c3',
    call: {
      name: 'bash',
      argsRaw: '{"command":"pwd","description":"x","sandbox_permissions":"workspace-write","justification":""}',
    },
    subCalls: [],
  }
  const sanitizedSettled = sanitizeBlock(settled)
  assert.deepEqual(JSON.parse(sanitizedSettled.call.argsRaw), { command: 'pwd', description: 'x' })
})

test('sanitizeBlock rewrites nested subCalls', () => {
  const block = {
    callId: 'root',
    name: 'bash',
    argsRaw: '{"command":"echo root","description":"root"}',
    subCalls: [{
      callId: 'child',
      name: 'bash',
      argsRaw: '{"command":"echo child","description":"child","sandbox_permissions":"workspace-write","justification":""}',
      subCalls: [],
    }],
  }
  const sanitized = sanitizeBlock(block)
  assert.equal(sanitized.argsRaw, block.argsRaw)
  assert.deepEqual(JSON.parse(sanitized.subCalls[0].argsRaw), { command: 'echo child', description: 'child' })
})
