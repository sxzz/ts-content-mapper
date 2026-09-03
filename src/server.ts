import { stdin, stdout } from 'node:process'
import {
  createMessageConnection,
  ErrorCodes,
  RequestType,
  ResponseError,
  type CancellationToken,
} from 'vscode-jsonrpc/node'
import type {
  CloseProjectParams,
  InitializeParams,
  InitializeResult,
  OpenProjectParams,
  OpenProjectResult,
  PositionEncoding,
  TransformParams,
  TransformResult,
} from './protocol.ts'

type Awaitable<Value> = Value | PromiseLike<Value>

export interface ContentMapperContext {
  positionEncoding: PositionEncoding
  locale?: string
  signal: AbortSignal
}

export interface ProjectContext<
  Project,
  Options = Record<string, unknown>,
> extends ContentMapperContext {
  project: Project
  openProjectParams: OpenProjectParams<Options>
}

type OpenProjectHandlerResult<Project> = OpenProjectResult & {
  /** Mapper-owned state; never sent over JSON-RPC. */
  project?: Project
}

export interface ContentMapperDefinition<
  Options = Record<string, unknown>,
  Project = undefined,
> {
  diagnosticSource: string
  /** Defaults to UTF-16. Choose UTF-8 for byte-offset based transformers. */
  positionEncoding?: PositionEncoding
  openProject?: (
    params: OpenProjectParams<Options>,
    context: ContentMapperContext,
  ) => Awaitable<OpenProjectHandlerResult<Project>>
  transform: (
    params: TransformParams,
    context: ProjectContext<Project, Options>,
  ) => Awaitable<TransformResult>
  closeProject?: (
    params: CloseProjectParams,
    context: ProjectContext<Project, Options>,
  ) => Awaitable<void>
}

export interface RunContentMapperOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
}

export interface RunningContentMapper {
  dispose: () => void
}

interface ProjectEntry<Options, Project> {
  project: Project
  params: OpenProjectParams<Options>
}

/** Start a content mapper over stdin/stdout. */
export function runContentMapper<
  Options = Record<string, unknown>,
  Project = undefined,
>(
  definition: ContentMapperDefinition<Options, Project>,
  options: RunContentMapperOptions = {},
): RunningContentMapper {
  const connection = createMessageConnection(
    options.input ?? stdin,
    options.output ?? stdout,
  )
  const projects = new Map<string, ProjectEntry<Options, Project>>()
  let session: Omit<ContentMapperContext, 'signal'> | undefined

  const initializeRequest = new RequestType<
    InitializeParams,
    InitializeResult,
    void
  >('initialize')
  const openProjectRequest = new RequestType<
    OpenProjectParams<Options>,
    OpenProjectResult,
    void
  >('openProject')
  const transformRequest = new RequestType<
    TransformParams,
    TransformResult,
    void
  >('transform')
  const closeProjectRequest = new RequestType<CloseProjectParams, null, void>(
    'closeProject',
  )

  connection.onRequest(initializeRequest, (params) => {
    const positionEncoding = selectPositionEncoding(
      params.positionEncodings,
      definition.positionEncoding,
    )
    session = { positionEncoding, locale: params.locale }
    return { positionEncoding, diagnosticSource: definition.diagnosticSource }
  })

  connection.onRequest(openProjectRequest, (params, token) =>
    withCancellation(token, async (signal) => {
      const context = createContext(requireSession(session), signal)
      const handled = definition.openProject
        ? await definition.openProject(params, context)
        : {}
      const { project, ...result } = handled
      projects.set(params.projectHandle, {
        project: project as Project,
        params,
      })
      return result
    }),
  )

  connection.onRequest(transformRequest, (params, token) =>
    withCancellation(token, (signal) => {
      const entry = requireProject(projects, params.projectHandle)
      return definition.transform(
        params,
        createProjectContext(requireSession(session), entry, signal),
      )
    }),
  )

  connection.onRequest(closeProjectRequest, (params, token) =>
    withCancellation(token, async (signal) => {
      const entry = requireProject(projects, params.projectHandle)
      try {
        await definition.closeProject?.(
          params,
          createProjectContext(requireSession(session), entry, signal),
        )
      } finally {
        projects.delete(params.projectHandle)
      }
      return null
    }),
  )

  connection.listen()
  return {
    dispose(): void {
      projects.clear()
      connection.dispose()
    },
  }
}

function selectPositionEncoding(
  offered: readonly PositionEncoding[],
  preferred: PositionEncoding | undefined,
): PositionEncoding {
  if (preferred !== undefined) {
    if (offered.includes(preferred)) return preferred
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      `The host did not offer ${JSON.stringify(preferred)} position encoding`,
    )
  }
  if (offered.includes('utf-16')) return 'utf-16'
  if (offered.includes('utf-8')) return 'utf-8'
  throw new ResponseError(
    ErrorCodes.InvalidParams,
    'The host did not offer a supported position encoding',
  )
}

function requireSession(
  session: Omit<ContentMapperContext, 'signal'> | undefined,
): Omit<ContentMapperContext, 'signal'> {
  if (session === undefined) {
    throw new ResponseError(
      ErrorCodes.InvalidRequest,
      'The content mapper has not been initialized',
    )
  }
  return session
}

function requireProject<Options, Project>(
  projects: Map<string, ProjectEntry<Options, Project>>,
  handle: string,
): ProjectEntry<Options, Project> {
  const project = projects.get(handle)
  if (project === undefined) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      `Unknown project handle ${JSON.stringify(handle)}`,
    )
  }
  return project
}

function createContext(
  session: Omit<ContentMapperContext, 'signal'>,
  signal: AbortSignal,
): ContentMapperContext {
  return { ...session, signal }
}

function createProjectContext<Options, Project>(
  session: Omit<ContentMapperContext, 'signal'>,
  entry: ProjectEntry<Options, Project>,
  signal: AbortSignal,
): ProjectContext<Project, Options> {
  return {
    ...session,
    signal,
    project: entry.project,
    openProjectParams: entry.params,
  }
}

async function withCancellation<Result>(
  token: CancellationToken,
  operation: (signal: AbortSignal) => Awaitable<Result>,
): Promise<Result> {
  const controller = new AbortController()
  if (token.isCancellationRequested) controller.abort()
  const cancellation = token.onCancellationRequested(() => controller.abort())
  try {
    return await operation(controller.signal)
  } finally {
    cancellation.dispose()
  }
}
