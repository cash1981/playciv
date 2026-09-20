/**
 * The signup security question (issue #40).
 *
 * The old gate lived only in the AngularJS client
 * (`RegisterController.js:37-40`), so a direct POST to `/api/auth/register`
 * skipped it. The server now enforces the same fixed answer: the question is
 * "What is China's starting tech?" and the accepted answer is `writing`,
 * case-insensitive. See `docs/agents/tasks/issue-40-signup-security-question.md`
 * and `decisions.md`.
 */

import type { App } from '../src/app.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestApp } from '../src/app.js'
import type { JsonFileRepository } from '../src/store/json-file.js'
import { inject } from './helpers.js'

let app: App
let repo: JsonFileRepository

beforeEach(async () => {
  const created = await createTestApp()
  app = created.app
  repo = created.repo
})

describe('signup security question (issue #40)', () => {
  it.each(['writing', 'Writing', 'WRITING'])(
    'creates the account when the answer is %s',
    async (answer) => {
      const username = `answer-${answer}`
      const response = await inject(app, {
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username,
          password: 'hemmelig',
          email: `${username}@example.com`,
          securityAnswer: answer,
        },
      })

      expect(response.status).toBe(201)
      expect(await repo.findPlayerByUsername(username)).toBeDefined()
    },
  )

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'the wheel'],
    // The old controller compared the raw value with no trimming, so a space
    // makes the answer wrong there and wrong here.
    ['padded', ' writing'],
  ] as const)(
    'rejects a %s answer with WRONG_SECURITY_ANSWER and creates no account',
    async (_label, securityAnswer) => {
      const username = 'rejected-answer'
      const response = await inject(app, {
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          username,
          password: 'hemmelig',
          email: `${username}@example.com`,
          securityAnswer,
        },
      })

      expect(response.status).toBe(400)
      expect((await response.json<{ readonly error: string }>()).error).toBe(
        'WRONG_SECURITY_ANSWER',
      )
      expect(await repo.findPlayerByUsername(username)).toBeUndefined()
    },
  )
})
