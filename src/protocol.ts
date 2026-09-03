/** Coordinate system used by every offset exchanged with TypeScript. */
export type PositionEncoding = 'utf-8' | 'utf-16'

export interface InitializeParams {
  /** BCP 47 locale for diagnostics authored by the mapper. */
  locale?: string
  /** Encodings accepted by the TypeScript host. */
  positionEncodings: PositionEncoding[]
}

export interface InitializeResult {
  positionEncoding: PositionEncoding
  /** Prefix TypeScript attaches to mapper-authored diagnostic codes. */
  diagnosticSource: string
}

export interface OpenProjectParams<Options = Record<string, unknown>> {
  /** Absolute tsconfig path, or an empty string for projects without one. */
  configFileName: string
  /** Opaque process-local handle allocated by TypeScript. */
  projectHandle: string
  /** Options from this mapper's entry in `contentMappers`. */
  options?: Options
  /** Effective options named by the mapper package's manifest. */
  compilerOptions: Record<string, unknown>
}

export interface OptionDiagnostic {
  /** Property names and array indexes relative to the mapper's options. */
  path: Array<string | number>
  messageText: string
  code: number
}

export interface OpenProjectResult {
  /** Required when the package manifest declares `dynamicConfig: true`. */
  configIdentity?: string
  /** Absolute files that can change the dynamic configuration. */
  watchedFiles?: string[]
  optionDiagnostics?: OptionDiagnostic[]
}

export interface CloseProjectParams {
  projectHandle: string
}

export interface TransformParams {
  fileName: string
  /** Complete original source text. */
  content: string
  projectHandle: string
}

export type VirtualExtension =
  '.js' | '.jsx' | '.mjs' | '.cjs' | '.ts' | '.tsx' | '.mts' | '.cts' | '.json'

/** How positions inside one mapped segment relate to its original span. */
export const SpanMapKind = {
  Verbatim: 0,
  Atom: 1,
  Alias: 2,
} as const

export type SpanMapKind = (typeof SpanMapKind)[keyof typeof SpanMapKind]

/** Language-service operations that may use a mapping segment. */
export const SpanMapFeature = {
  None: 0,
  Hover: 1,
  SignatureHelp: 2,
  Completion: 4,
  Definition: 8,
  TypeDefinition: 16,
  Implementation: 32,
  References: 64,
  DocumentHighlights: 128,
  Rename: 256,
  CallHierarchy: 512,
  CodeActions: 1_024,
  Formatting: 2_048,
  InlayHints: 4_096,
  SemanticTokens: 8_192,
  FoldingRanges: 16_384,
  SelectionRanges: 32_768,
  LinkedEditing: 65_536,
  AutoInsert: 131_072,
  DocumentSymbols: 262_144,
  CodeLens: 524_288,
  All: 1_048_575,
} as const

export type SpanMapFeatures = number

/**
 * `[virtualStart, virtualLength, originalStart, originalLength, kind,
 * features?]`. Omitting features means {@link SpanMapFeature.All}.
 */
export type SpanMapping = readonly [
  virtualStart: number,
  virtualLength: number,
  originalStart: number,
  originalLength: number,
  kind: SpanMapKind,
  features?: SpanMapFeatures,
]

export const DiagnosticDirectivePolicy = {
  Ignore: 0,
  Expect: 1,
} as const

export type DiagnosticDirectivePolicy =
  (typeof DiagnosticDirectivePolicy)[keyof typeof DiagnosticDirectivePolicy]

export interface UnusedExpectDirectiveDiagnostic {
  code: number
  messageText: string
}

/**
 * `[originalStart, originalLength, virtualStart, virtualEnd, policy,
 * unusedExpectDirectiveIndex?]`.
 */
export type MappedDiagnosticDirective = readonly [
  originalStart: number,
  originalLength: number,
  virtualStart: number,
  virtualEnd: number,
  policy: DiagnosticDirectivePolicy,
  unusedExpectDirectiveIndex?: number,
]

export interface DiagnosticDirectives {
  unusedExpectDirectiveDiagnostics: UnusedExpectDirectiveDiagnostic[]
  directives: MappedDiagnosticDirective[]
}

export interface MappedOutput {
  text: string
  extension: VirtualExtension
  /** Missing or empty means the virtual output is fully synthesized. */
  mappings?: SpanMapping[]
  diagnosticDirectives?: DiagnosticDirectives
}

export interface ContentMapperDiagnostic {
  messageText: string
  /** Original-source coordinates in the negotiated position encoding. */
  start: number
  length: number
  code: number
}

export interface TransformResult extends MappedOutput {
  diagnostics?: ContentMapperDiagnostic[]
  supplemental?: MappedOutput[]
}

/** `package.json#typescript.contentMapper` consumed by TypeScript. */
export interface ContentMapperManifest {
  exec: [command: string, ...arguments_: string[]]
  compilerOptions?: string[]
  dynamicConfig?: boolean
}
