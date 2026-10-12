// SPDX-License-Identifier: AGPL-3.0-or-later
// Detección de tests fallidos: un comando de tests que termina con error marca `testFailed`.
import { describe, expect, test } from 'claude-code/testing'

import { isFailedTestRun, isTestCommand } from '../hooks/lib/bash.ts'
import {
  LOGGED_IN,
  TEST_OPTIONS,
  bashTool,
  happyCasino,
  playTurn,
  startSession,
  world,
} from './support/harness.ts'

describe('isTestCommand', () => {
  test('recognises test runners across ecosystems', () => {
    for (const command of [
      'npm test',
      'npm run test:unit',
      'pnpm test',
      'pnpm -r test',
      'pnpm --filter @vibe-gambling/server test',
      'pnpm run test',
      'yarn test',
      'yarn workspace web test',
      'bun test',
      'npx vitest run',
      'vitest',
      'jest --ci',
      'pytest -q',
      'python -m pytest tests/',
      'go test ./...',
      'cargo test',
      'dotnet test',
      'mvn test',
      './gradlew test',
      'make test',
      'npx playwright test',
      'claude plugin test packages/mod',
      'cd server && CI=1 pnpm test',
    ]) {
      expect(isTestCommand(command), command).toBe(true)
    }
  })

  test('ignores everything else', () => {
    for (const command of [
      'ls',
      'npm install',
      'pnpm build',
      'git status',
      'cat test.txt',
      'echo test',
      'go build ./...',
      'cargo build',
      'grep -r test src',
    ]) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })

  test('recognises runners launched through a package manager or a wrapper', () => {
    for (const command of [
      'pnpm vitest',
      'pnpm vitest run --coverage',
      'pnpm exec vitest run',
      'pnpm dlx vitest',
      'pnpm --filter @vibe-gambling/web exec playwright test',
      'yarn jest --ci',
      'yarn dlx vitest',
      'bun x vitest',
      'bunx vitest',
      'npm exec -- jest',
      'npm t',
      'npx --yes jest',
      'uv run pytest -q',
      'uv run python -m pytest',
      'poetry run pytest',
      'pipenv run pytest',
      'bundle exec rspec',
      'deno test',
      'timeout 600 pnpm test',
      'timeout -s KILL 10m npm test',
      '(cd server && pnpm test)',
      'sudo -u ci npm test',
    ]) {
      expect(isTestCommand(command), command).toBe(true)
    }
  })

  test('installing or removing a test runner is not running tests', () => {
    for (const command of [
      'pnpm add -D vitest',
      'npm install jest',
      'yarn add vitest',
      'pnpm remove jest',
      'uv pip install pytest',
      'poetry add pytest',
      'bundle install',
      'echo pnpm test',
      'which vitest',
    ]) {
      expect(isTestCommand(command), command).toBe(false)
    }
  })

  test('only a failing run counts', () => {
    expect(
      isFailedTestRun('pnpm test', { succeeded: false, failed: true, nothingPushed: false }),
    ).toBe(true)
    expect(
      isFailedTestRun('pnpm test', { succeeded: true, failed: false, nothingPushed: false }),
    ).toBe(false)
    expect(
      isFailedTestRun('ls nope', { succeeded: false, failed: true, nothingPushed: false }),
    ).toBe(false)
  })
})

describe('in a real turn', () => {
  test('a failing test run sets testFailed', { options: TEST_OPTIONS }, async ($, on) => {
    bashTool(on)
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    await playTurn($, w, {
      bash: [
        { command: 'pnpm test' },
        { command: 'pnpm test', exitCode: 1 },
        { command: 'pnpm test' },
      ],
    })
    expect(w.to('/api/turn/end')[0]?.body).toMatchObject({ testFailed: true, gitPushOk: false })
  })

  test(
    'green tests and other failing commands do not',
    { options: TEST_OPTIONS },
    async ($, on) => {
      bashTool(on)
      const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
      await startSession($, w)
      await playTurn($, w, {
        bash: [{ command: 'pnpm test' }, { command: 'ls missing', exitCode: 2 }],
      })
      expect(w.to('/api/turn/end')[0]?.body).toMatchObject({ testFailed: false })
    },
  )
})
