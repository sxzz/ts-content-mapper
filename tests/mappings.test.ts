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

  test('rejects incorrect verbatim content', () => {
    expect(() =>
      new MappedCodeBuilder('source').appendMapped('changed', 0, 6, {
        kind: SpanMapKind.Verbatim,
      }),
    ).toThrow(/Verbatim text/)
  })
})
