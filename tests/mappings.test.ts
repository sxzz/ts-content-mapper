import { describe, expect, test } from 'vitest'
import {
  encodedLength,
  MappedCodeBuilder,
  SpanMapFeature,
  SpanMapKind,
  stringIndexToPosition,
} from '../src/index.ts'

describe('position encoding', () => {
  test('counts UTF-8 bytes and UTF-16 code units', () => {
    const text = 'a🥟文'

    expect(encodedLength(text, 'utf-16')).toBe(4)
    expect(encodedLength(text, 'utf-8')).toBe(8)
    expect(stringIndexToPosition(text, 3, 'utf-8')).toBe(5)
    expect(() => stringIndexToPosition(text, 2, 'utf-8')).toThrow(RangeError)
  })
})

describe('MappedCodeBuilder', () => {
  test('merges adjacent verbatim mappings', () => {
    const output = new MappedCodeBuilder('hello')
      .appendVerbatim(0, 2)
      .appendVerbatim(2, 5)
      .build('.ts')

    expect(output).toEqual({
      text: 'hello',
      extension: '.ts',
      mappings: [[0, 5, 0, 5, SpanMapKind.Verbatim]],
    })
  })

  test('builds UTF-8 alias and anchored mappings', () => {
    const navigation = SpanMapFeature.Definition | SpanMapFeature.References
    const output = new MappedCodeBuilder('🥟name', {
      positionEncoding: 'utf-8',
    })
      .appendVerbatim(0, 2)
      .appendAlias('value', 2, 6)
      .append(';')
      .appendAnchored('generated', 6, navigation)
      .build('.ts')

    expect(output).toEqual({
      text: '🥟value;generated',
      extension: '.ts',
      mappings: [
        [0, 4, 0, 4, SpanMapKind.Verbatim],
        [4, 5, 4, 4, SpanMapKind.Alias],
        [10, 9, 8, 0, SpanMapKind.Atom, navigation],
      ],
    })
  })

  test('does not merge verbatim mappings across gaps or feature changes', () => {
    const output = new MappedCodeBuilder('abcdef')
      .appendVerbatim(0, 1)
      .append(';')
      .appendVerbatim(1, 2)
      .appendVerbatim(3, 4)
      .appendVerbatim(4, 5, SpanMapFeature.Hover)
      .build('.ts')

    expect(output.mappings).toEqual([
      [0, 1, 0, 1, SpanMapKind.Verbatim],
      [2, 1, 1, 1, SpanMapKind.Verbatim],
      [3, 1, 3, 1, SpanMapKind.Verbatim],
      [4, 1, 4, 1, SpanMapKind.Verbatim, SpanMapFeature.Hover],
    ])
  })

  test('omits empty mappings and passes diagnostic directives through', () => {
    const diagnosticDirectives = {
      unusedExpectDirectiveDiagnostics: [],
      directives: [],
    }

    expect(new MappedCodeBuilder('').append('x').build('.ts')).toEqual({
      text: 'x',
      extension: '.ts',
    })
    expect(
      new MappedCodeBuilder('').build('.ts', { diagnosticDirectives }),
    ).toEqual({ text: '', extension: '.ts', diagnosticDirectives })
  })

  test('rejects invalid source ranges', () => {
    const builder = new MappedCodeBuilder('source')

    expect(() => builder.appendVerbatim(3, 2)).toThrow(RangeError)
    expect(() => builder.appendVerbatim(0, 7)).toThrow(RangeError)
    expect(() => builder.appendVerbatim(0.5, 2)).toThrow(RangeError)
    expect(() => builder.appendVerbatim(-1, 2)).toThrow(RangeError)
  })

  test('rejects incorrect verbatim content', () => {
    expect(() =>
      new MappedCodeBuilder('source').appendMapped('changed', 0, 6, {
        kind: SpanMapKind.Verbatim,
      }),
    ).toThrow(/Verbatim text/)
  })
})
