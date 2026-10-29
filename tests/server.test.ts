import { PassThrough } from 'node:stream'
import { expect, test, vi } from 'vitest'
import {
  CancellationTokenSource,
  createMessageConnection,
  type MessageConnection,
} from 'vscode-jsonrpc/node'
import {
  MappedCodeBuilder,
  runContentMapper,
  type ContentMapperDefinition,
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

test('rejects position encodings the host did not offer', async () => {
  await withMapper(
    { diagnosticSource: 'utf8', positionEncoding: 'utf-8', transform },
    async (client) => {
      await expect(
        client.sendRequest('initialize', { positionEncodings: ['utf-16'] }),
      ).rejects.toThrow(/did not offer "utf-8"/)
    },
  )
  await withMapper({ diagnosticSource: 'demo', transform }, async (client) => {
    await expect(
      client.sendRequest('initialize', { positionEncodings: [] }),
    ).rejects.toThrow(/supported position encoding/)
  })
})

test('rejects requests for uninitialized sessions and unknown projects', async () => {
  await withMapper({ diagnosticSource: 'demo', transform }, async (client) => {
    await expect(
      client.sendRequest('openProject', openProjectParams),
    ).rejects.toThrow(/not been initialized/)

    await client.sendRequest('initialize', { positionEncodings: ['utf-16'] })
    await client.sendRequest('openProject', openProjectParams)
    await client.sendRequest('closeProject', { projectHandle: 'p1' })
    await expect(
      client.sendRequest('transform', transformParams),
    ).rejects.toThrow(/Unknown project handle "p1"/)
  })
})

test('aborts the signal when the client cancels a request', async () => {
  const started = deferred()
  const aborted = deferred()
  await withMapper(
    {
      diagnosticSource: 'demo',
      async transform(params, context) {
        context.signal.addEventListener('abort', () => aborted.resolve())
        started.resolve()
        await aborted.promise
        return transform(params)
      },
    },
    async (client) => {
      await client.sendRequest('initialize', { positionEncodings: ['utf-16'] })
      await client.sendRequest('openProject', openProjectParams)
      const source = new CancellationTokenSource()
      const request = client
        .sendRequest('transform', transformParams, source.token)
        .catch(() => {})
      await started.promise
      source.cancel()
      await aborted.promise
      await request
    },
  )
})

const openProjectParams = {
  configFileName: '',
  projectHandle: 'p1',
  compilerOptions: {},
}

const transformParams = {
  fileName: '/source.demo',
  content: 'export {}',
  projectHandle: 'p1',
}

function transform(params: { content: string }): TransformResult {
  return { text: params.content, extension: '.ts' }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

async function withMapper(
  definition: ContentMapperDefinition,
  run: (client: MessageConnection) => Promise<void>,
): Promise<void> {
  const clientToServer = new PassThrough()
  const serverToClient = new PassThrough()
  const server = runContentMapper(definition, {
    input: clientToServer,
    output: serverToClient,
  })
  const client = createMessageConnection(serverToClient, clientToServer)
  client.listen()
  try {
    await run(client)
  } finally {
    client.dispose()
    server.dispose()
  }
}
