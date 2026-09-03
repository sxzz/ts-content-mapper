import { Buffer } from 'node:buffer'
import {
  SpanMapFeature,
  SpanMapKind,
  type DiagnosticDirectives,
  type MappedOutput,
  type PositionEncoding,
  type SpanMapFeatures,
  type SpanMapKind as SpanMapKindType,
  type SpanMapping,
  type VirtualExtension,
} from './protocol.ts'

export interface MappedCodeBuilderOptions {
  /** Defaults to `utf-16`, matching JavaScript string indices. */
  positionEncoding?: PositionEncoding
}

interface AppendMappedOptions {
  kind?: SpanMapKindType
  features?: SpanMapFeatures
}

interface BuildMappedOutputOptions {
  diagnosticDirectives?: DiagnosticDirectives
}

/** Length of `text` in the negotiated coordinate system. */
export function encodedLength(
  text: string,
  encoding: PositionEncoding,
): number {
  return encoding === 'utf-8' ? Buffer.byteLength(text, 'utf8') : text.length
}

/** Convert a JavaScript string index to a protocol offset. */
export function stringIndexToPosition(
  text: string,
  index: number,
  encoding: PositionEncoding,
): number {
  assertStringIndex(text, index)
  return encoding === 'utf-8'
    ? Buffer.byteLength(text.slice(0, index), 'utf8')
    : index
}

/** Build virtual source and its compact span mappings. */
export class MappedCodeBuilder {
  readonly originalText: string
  readonly positionEncoding: PositionEncoding

  #chunks: string[] = []
  #mappings: SpanMapping[] = []
  #virtualPosition = 0

  constructor(originalText: string, options: MappedCodeBuilderOptions = {}) {
    this.originalText = originalText
    this.positionEncoding = options.positionEncoding ?? 'utf-16'
  }

  /** Current virtual offset in the selected position encoding. */
  get length(): number {
    return this.#virtualPosition
  }

  get text(): string {
    return this.#chunks.join('')
  }

  /** Append synthesized code with no original counterpart. */
  append(text: string): this {
    this.#appendText(text)
    return this
  }

  /** Append an unchanged original slice with exact 1:1 geometry. */
  appendVerbatim(
    originalStart: number,
    originalEnd: number,
    features: SpanMapFeatures = SpanMapFeature.All,
  ): this {
    assertSourceRange(this.originalText, originalStart, originalEnd)
    return this.appendMapped(
      this.originalText.slice(originalStart, originalEnd),
      originalStart,
      originalEnd,
      { kind: SpanMapKind.Verbatim, features },
    )
  }

  /** Map generated text to an original span as one indivisible unit. */
  appendAtom(
    text: string,
    originalStart: number,
    originalEnd: number,
    features: SpanMapFeatures = SpanMapFeature.All,
  ): this {
    return this.appendMapped(text, originalStart, originalEnd, {
      kind: SpanMapKind.Atom,
      features,
    })
  }

  /** Map a generated name to an equivalent original name. */
  appendAlias(
    text: string,
    originalStart: number,
    originalEnd: number,
    features: SpanMapFeatures = SpanMapFeature.All,
  ): this {
    return this.appendMapped(text, originalStart, originalEnd, {
      kind: SpanMapKind.Alias,
      features,
    })
  }

  /** Anchor generated navigation targets at an original insertion point. */
  appendAnchored(
    text: string,
    originalPosition: number,
    features: SpanMapFeatures = SpanMapFeature.Definition |
      SpanMapFeature.References,
  ): this {
    return this.appendAtom(text, originalPosition, originalPosition, features)
  }

  /** Append text with explicit mapping kind and language-service features. */
  appendMapped(
    text: string,
    originalStart: number,
    originalEnd: number,
    options: AppendMappedOptions = {},
  ): this {
    assertSourceRange(this.originalText, originalStart, originalEnd)

    const kind = options.kind ?? SpanMapKind.Atom
    const features = options.features ?? SpanMapFeature.All
    const virtualStart = this.#virtualPosition
    const virtualLength = encodedLength(text, this.positionEncoding)
    const encodedOriginalStart = stringIndexToPosition(
      this.originalText,
      originalStart,
      this.positionEncoding,
    )
    const encodedOriginalEnd = stringIndexToPosition(
      this.originalText,
      originalEnd,
      this.positionEncoding,
    )

    if (
      kind === SpanMapKind.Verbatim &&
      text !== this.originalText.slice(originalStart, originalEnd)
    ) {
      throw new TypeError('Verbatim text must match the original source')
    }

    this.#appendText(text)
    this.#pushMapping(
      features === SpanMapFeature.All
        ? [
            virtualStart,
            virtualLength,
            encodedOriginalStart,
            encodedOriginalEnd - encodedOriginalStart,
            kind,
          ]
        : [
            virtualStart,
            virtualLength,
            encodedOriginalStart,
            encodedOriginalEnd - encodedOriginalStart,
            kind,
            features,
          ],
    )
    return this
  }

  build(
    extension: VirtualExtension,
    options: BuildMappedOutputOptions = {},
  ): MappedOutput {
    return {
      text: this.text,
      extension,
      ...(this.#mappings.length === 0 ? {} : { mappings: [...this.#mappings] }),
      ...(options.diagnosticDirectives === undefined
        ? {}
        : { diagnosticDirectives: options.diagnosticDirectives }),
    }
  }

  #appendText(text: string): void {
    this.#chunks.push(text)
    this.#virtualPosition += encodedLength(text, this.positionEncoding)
  }

  #pushMapping(mapping: SpanMapping): void {
    const previous = this.#mappings.at(-1)
    if (previous === undefined || !canMergeVerbatim(previous, mapping)) {
      this.#mappings.push(mapping)
      return
    }

    const features = mapping[5] ?? SpanMapFeature.All
    this.#mappings[this.#mappings.length - 1] =
      features === SpanMapFeature.All
        ? [
            previous[0],
            previous[1] + mapping[1],
            previous[2],
            previous[3] + mapping[3],
            SpanMapKind.Verbatim,
          ]
        : [
            previous[0],
            previous[1] + mapping[1],
            previous[2],
            previous[3] + mapping[3],
            SpanMapKind.Verbatim,
            features,
          ]
  }
}

function canMergeVerbatim(a: SpanMapping, b: SpanMapping): boolean {
  return (
    a[4] === SpanMapKind.Verbatim &&
    b[4] === SpanMapKind.Verbatim &&
    (a[5] ?? SpanMapFeature.All) === (b[5] ?? SpanMapFeature.All) &&
    a[0] + a[1] === b[0] &&
    a[2] + a[3] === b[2]
  )
}

function assertSourceRange(text: string, start: number, end: number): void {
  assertStringIndex(text, start)
  assertStringIndex(text, end)
  if (end < start) throw new RangeError('Source range end is before its start')
}

function assertStringIndex(text: string, index: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index > text.length) {
    throw new RangeError(`String index ${index} is out of bounds`)
  }
  if (
    index > 0 &&
    index < text.length &&
    isHighSurrogate(text[index - 1]!.codePointAt(0)!) &&
    isLowSurrogate(text[index]!.codePointAt(0)!)
  ) {
    throw new RangeError(`String index ${index} splits a surrogate pair`)
  }
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff
}

function isLowSurrogate(value: number): boolean {
  return value >= 0xdc00 && value <= 0xdfff
}
