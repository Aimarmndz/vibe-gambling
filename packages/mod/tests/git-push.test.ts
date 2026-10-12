// SPDX-License-Identifier: AGPL-3.0-or-later
// Detección de `git push`: cuenta solo un push real que subió algo y terminó bien.
import { describe, expect, test } from 'claude-code/testing'

import { isGitPush, isSuccessfulGitPush, splitCommands } from '../hooks/lib/bash.ts'
import {
  LOGGED_IN,
  TEST_OPTIONS,
  bash,
  bashTool,
  happyCasino,
  playTurn,
  startSession,
  world,
} from './support/harness.ts'

const ok = { succeeded: true, failed: false, nothingPushed: false }
const failed = { succeeded: false, failed: true, nothingPushed: false }

describe('isGitPush', () => {
  test('recognises the usual spellings', () => {
    for (const command of [
      'git push',
      'git push origin main',
      'git push -u origin feat/x',
      'git -C ../repo push',
      'GIT_SSH_COMMAND="ssh -i k" git push',
      'cd app && git push --force-with-lease',
      '/usr/bin/git push',
      'git commit -m "x; y" && git push',
    ]) {
      expect(isGitPush(command), command).toBe(true)
    }
  })

  test('ignores what is not a real push', () => {
    for (const command of [
      'git status',
      'git push --dry-run',
      'git push -n origin main',
      'echo "git push"',
      'git commit -m "remember to git push"',
      'npm run push',
      'gh pr create',
    ]) {
      expect(isGitPush(command), command).toBe(false)
    }
  })

  test('splits on operators but not inside quotes or redirections', () => {
    expect(splitCommands('a && b || c; d | e').map(s => s.text)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(splitCommands('git push 2>&1').map(s => s.text)).toEqual(['git push 2>&1'])
    expect(splitCommands("echo 'a && b'")).toHaveLength(1)
  })
})

describe('isSuccessfulGitPush', () => {
  test('counts a push that ended well', () => {
    expect(isSuccessfulGitPush('git push origin main', ok)).toBe(true)
    expect(isSuccessfulGitPush('git add . && git commit -m x && git push', ok)).toBe(true)
    expect(isSuccessfulGitPush('git push && echo shipped', ok)).toBe(true)
  })

  test('does not count a failed push, an empty push, or one whose exit code is lost', () => {
    expect(isSuccessfulGitPush('git push', failed)).toBe(false)
    expect(isSuccessfulGitPush('git push', { ...ok, nothingPushed: true })).toBe(false)
    expect(isSuccessfulGitPush('git push; echo done', ok)).toBe(false)
    expect(isSuccessfulGitPush('git push || true', ok)).toBe(false)
    expect(isSuccessfulGitPush('git push | tee log', ok)).toBe(false)
    expect(isSuccessfulGitPush('git push &', ok)).toBe(false)
  })
})

describe('in a real turn', () => {
  test('a successful push sets gitPushOk in turn/end', { options: TEST_OPTIONS }, async ($, on) => {
    bashTool(on)
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    await playTurn($, w, {
      bash: [
        { command: 'git status' },
        {
          command: 'git push origin main',
          stderr: 'To github.com:me/repo.git\n  a..b  main -> main',
        },
      ],
    })
    const [end] = w.to('/api/turn/end')
    expect(end?.body).toMatchObject({ gitPushOk: true, testFailed: false })
  })

  test('a rejected push does not', { options: TEST_OPTIONS }, async ($, on) => {
    bashTool(on)
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    await playTurn($, w, {
      bash: [
        { command: 'git push', exitCode: 1, stderr: '! [rejected] main -> main (fetch first)' },
      ],
    })
    expect(w.to('/api/turn/end')[0]?.body).toMatchObject({ gitPushOk: false })
  })

  test(
    '"Everything up-to-date" is not a push to prod',
    { options: TEST_OPTIONS },
    async ($, on) => {
      bashTool(on)
      const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
      await startSession($, w)
      await playTurn($, w, { bash: [{ command: 'git push', stderr: 'Everything up-to-date' }] })
      expect(w.to('/api/turn/end')[0]?.body).toMatchObject({ gitPushOk: false })
    },
  )

  test(
    'the flag belongs to its turn and does not leak into the next one',
    { options: TEST_OPTIONS },
    async ($, on) => {
      bashTool(on)
      const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
      await startSession($, w)
      await playTurn($, w, { bash: [{ command: 'git push' }] })
      await playTurn($, w)
      const ends = w.to('/api/turn/end').map(request => request.body)
      expect(ends).toMatchObject([{ gitPushOk: true }, { gitPushOk: false }])
    },
  )

  test('a push outside any turn is ignored', { options: TEST_OPTIONS }, async ($, on) => {
    bashTool(on)
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    await bash($, { command: 'git push' })
    await playTurn($, w)
    expect(w.to('/api/turn/end')[0]?.body).toMatchObject({ gitPushOk: false })
  })
})
