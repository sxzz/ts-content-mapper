import { PassThrough } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import {
  MappedCodeBuilder,
  runContentMapper,
  type InitializeResult,
  type OpenProjectResult,
  type TransformResult,
} from '../src/index.ts'

interface TestOptions {
  prefix: string
}

interface TestProject {
  prefix: string
}

test('serves typed project state over JSON-RPC', async () => {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const closed = vi.fn()
  const server = runContentMapper<TestOptions, TestProject>(
    {
      diagnosticSource: 'example',
      openProject(params) {
        return { project: { prefix: params.options?.prefix ?? '' } }
      },
      transform(params, context) {
        return new MappedCodeBuilder(params.content, {
          positionEncoding: context.positionEncoding,
        })
          .append(context.project.prefix)
          .appendVerbatim(0, params.content.length)
          .build('.ts')
      },
      closeProject(_params, context) {
        closed(context.project.prefix)
      },
    },
    { input: clientToServer, output: serverToClient },
  )
  const client = createMessageConnection(serverToClient, clientToServer)
  client.listen()

  try {
    await expect(
      client.sendRequest<InitializeResult>('initialize', {
        positionEncodings: ['utf-8', 'utf-16'],
      }),
    ).resolves.toEqual({
      positionEncoding: 'utf-16',
      diagnosticSource: 'example',
    })
    await expect(
      client.sendRequest<OpenProjectResult>('openProject', {
        configFileName: '',
        projectHandle: 'p1',
        options: { prefix: 'export ' },
        compilerOptions: {},
      }),
    ).resolves.toEqual({})
    await expect(
      client.sendRequest<TransformResult>('transform', {
        fileName: '/source.demo',
        content: 'const value = 1',
        projectHandle: 'p1',
      }),
    ).resolves.toMatchObject({
      text: 'export const value = 1',
      extension: '.ts',
    })
    await expect(
      client.sendRequest('closeProject', { projectHandle: 'p1' }),
    ).resolves.toBeNull()
    expect(closed).toHaveBeenCalledWith('export ')
  } finally {
    client.dispose()
    server.dispose()
  }
})

test('does not require an openProject callback for stateless mappers', async () => {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const server = runContentMapper(
    {
      diagnosticSource: 'stateless',
      positionEncoding: 'utf-8',
      transform(params) {
        return { text: params.content, extension: '.ts' }
      },
    },
    { input: clientToServer, output: serverToClient },
  )
  const client = createMessageConnection(serverToClient, clientToServer)
  client.listen()

  try {
    await expect(
      client.sendRequest<InitializeResult>('initialize', {
        positionEncodings: ['utf-8', 'utf-16'],
      }),
    ).resolves.toEqual({
      positionEncoding: 'utf-8',
      diagnosticSource: 'stateless',
    })
    await client.sendRequest('openProject', {
      configFileName: '',
      projectHandle: 'p1',
      compilerOptions: {},
    })
    await expect(
      client.sendRequest<TransformResult>('transform', {
        fileName: '/source.demo',
        content: 'export {}',
        projectHandle: 'p1',
      }),
    ).resolves.toEqual({ text: 'export {}', extension: '.ts' })
  } finally {
    client.dispose()
    server.dispose()
  }
})
