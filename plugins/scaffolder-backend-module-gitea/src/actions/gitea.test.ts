/*
 * Copyright 2023 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { PassThrough } from 'stream';
import { ScmIntegrations } from '@backstage/integration';
import { ConfigReader } from '@backstage/config';
import { getVoidLogger } from '@backstage/backend-common';
import { createPublishGiteaAction } from './gitea';
import { initRepoAndPush } from '@backstage/plugin-scaffolder-node';
import { rest } from 'msw';
import { setupRequestMockHandlers } from '@backstage/backend-test-utils';
import { setupServer } from 'msw/node';

jest.mock('@backstage/plugin-scaffolder-node', () => {
  return {
    ...jest.requireActual('@backstage/plugin-scaffolder-node'),
    initRepoAndPush: jest.fn().mockResolvedValue({
      commitHash: '220f19cc36b551763d157f1b5e4a4b446165dbd6',
    }),
  };
});

describe('publish:gitea', () => {
  const config = new ConfigReader({
    integrations: {
      gitea: [
        {
          host: 'gitea.com',
          baseUrl: 'https://gitea.com',
          username: 'gitea_user',
          password: 'gitea_password',
        },
      ],
    },
  });

  const description = 'for the lols';
  const integrations = ScmIntegrations.fromConfig(config);
  const action = createPublishGiteaAction({ integrations, config });
  const mockContext = {
    input: {
      repoUrl: 'gitea.com?repo=repo&owner=owner',
      description,
    },
    workspacePath: 'lol',
    logger: getVoidLogger(),
    logStream: new PassThrough(),
    output: jest.fn(),
    createTemporaryDirectory: jest.fn(),
  };

  const server = setupServer();
  setupRequestMockHandlers(server);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should throw an error when the repoUrl is not well formed', async () => {
    await expect(
      action.handler({
        ...mockContext,
        input: { repoUrl: 'gitea.com?owner=o', description },
      }),
    ).rejects.toThrow(/missing repo/);
  });

  it('should throw if there is no integration config provided for missing.com host', async () => {
    await expect(
      action.handler({
        ...mockContext,
        input: { repoUrl: 'missing.com?repo=repo', description },
      }),
    ).rejects.toThrow(/No matching integration configuration/);
  });

  it('should throw if there is no repositoryId returned', async () => {
    server.use(
      rest.put('https://gitea.com/api/v1/user/repo', (req, res, ctx) => {
        expect(req.headers.get('Authorization')).toBe(
          'Basic Z2l0ZWFfdXNlcjpnaXRlYV9wYXNzd29yZA==',
        );
        expect(req.body).toEqual({
          create_empty_commit: false,
          owners: ['owner'],
          description,
          parent: 'workspace',
        });
        return res(
          ctx.status(201),
          ctx.set('Content-Type', 'application/json'),
          ctx.json({}),
        );
      }),
    );

    await action.handler({
      ...mockContext,
      input: {
        ...mockContext.input,
        repoUrl: 'gitea.com?owner=owner&repo=repo',
      },
    });

    expect(initRepoAndPush).toHaveBeenCalledWith({
      dir: mockContext.workspacePath,
      remoteUrl: 'https://gitea.com/api/v1/user/repo',
      defaultBranch: 'main',
      auth: { username: 'gitea_user', password: 'gitea_password' },
      logger: mockContext.logger,
      commitMessage: 'initial commit',
      gitAuthorInfo: {},
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });
});
