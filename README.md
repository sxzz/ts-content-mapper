# ts-content-mapper

[![Open on npmx][npmx-version-src]][npmx-href]
[![npm downloads][npmx-downloads-src]][npmx-href]
[![Unit Test][unit-test-src]][unit-test-href]

Type-safe SDK for writing [TypeScript 7 content mappers][typescript-pr]. It
contains the current protocol types, a UTF-8/UTF-16-aware mapping builder,
project state management, cancellation, and a ready-to-use server runner.

> [!IMPORTANT]
> Content mappers currently require TypeScript 7.1 nightly or newer and
> `--runExternalCode`. The upstream API is new and may still change.

## Install

```bash
npm i ts-content-mapper
```

## Quick start

Suppose a `.demo` file contains TypeScript between `<script>` tags. Its mapper
entry point can be written as:

```ts
// src/server.ts
import { MappedCodeBuilder, runContentMapper } from 'ts-content-mapper'

runContentMapper({
  diagnosticSource: 'demo',
  transform(params, context) {
    const open = '<script>'
    const start = params.content.indexOf(open) + open.length
    const end = params.content.indexOf('</script>', start)

    if (start < open.length || end === -1) {
      return {
        text: '',
        extension: '.ts',
        diagnostics: [
          {
            messageText: 'Expected a <script> block',
            start: 0,
            length: 0,
            code: 1,
          },
        ],
      }
    }

    return new MappedCodeBuilder(params.content, {
      positionEncoding: context.positionEncoding,
    })
      .appendVerbatim(start, end)
      .build('.ts')
  },
})
```

`MappedCodeBuilder` takes ordinary JavaScript string indices. It converts them
to the UTF-8 or UTF-16 coordinates negotiated with TypeScript, including for
emoji and other non-ASCII text.

The server selects UTF-16 by default. Set `positionEncoding: 'utf-8'` when the
underlying transformer works with byte offsets.

Declare the executable in the mapper package's `package.json`:

```json
{
  "name": "demo-content-mapper",
  "type": "module",
  "typescript": {
    "contentMapper": {
      "exec": ["node", "dist/server.js"],
      "compilerOptions": [],
      "dynamicConfig": false
    }
  }
}
```

Then a project can opt into the mapper from `tsconfig.json`:

```jsonc
{
  "contentMappers": [
    {
      "package": "demo-content-mapper",
      "extensions": [".demo"],
    },
  ],
  "include": ["src"],
}
```

Run TypeScript with permission to start the mapper process:

```bash
tsc --noEmit --runExternalCode
```

A runnable `.demo` mapper and consuming project are available in
[examples](./examples).

## Mapping builder

The virtual output is sparse: text appended with `append()` is synthesized and
has no original location. Mapped segments can be added with:

- `appendVerbatim(start, end)` — unchanged source, mapped exactly 1:1.
- `appendAtom(text, start, end)` — generated text mapped to a source span as a
  single indivisible unit.
- `appendAlias(text, start, end)` — an atom whose generated and original names
  represent the same logical symbol.
- `appendAnchored(text, position)` — generated text attached to a zero-length
  source position for definition/reference navigation.
- `appendMapped(...)` — the lower-level form with explicit kind and features.

Adjacent compatible verbatim segments are merged automatically. `build()`
produces the compact protocol tuple format:

```ts
type SpanMapping = [
  virtualStart,
  virtualLength,
  originalStart,
  originalLength,
  kind,
  features?,
]
```

Original spans may overlap. Virtual spans must be ordered and non-overlapping.
Gaps in virtual text are synthesized.

## Typed project state

`openProject` may return private `project` state. The SDK retains it by the
opaque `projectHandle`, passes it to `transform` and `closeProject`, and removes
it after close. The private value is never serialized:

```ts
interface Options {
  mode?: 'strict' | 'loose'
}

interface ProjectState {
  strict: boolean
}

runContentMapper<Options, ProjectState>({
  diagnosticSource: 'demo',

  openProject(params) {
    return {
      project: { strict: params.options?.mode === 'strict' },
    }
  },

  transform(params, context) {
    return {
      text: context.project.strict
        ? `'use strict';\n${params.content}`
        : params.content,
      extension: '.ts',
    }
  },
})
```

For a package that declares `dynamicConfig: true`, return a stable
`configIdentity` plus any absolute `watchedFiles` from `openProject`.

## Protocol exports

The package exports the full wire model, including:

- initialize, open/close project, transform, diagnostic and manifest types;
- `SpanMapKind` and every `SpanMapFeature`;
- diagnostic directive policies and compact tuple types;
- the supported virtual extension type;
- `encodedLength()` and `stringIndexToPosition()`.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg">
    <img src="https://cdn.jsdelivr.net/gh/sxzz/sponsors/sponsors.svg" alt="Sponsors" />
  </a>
</p>

## License

[MIT](./LICENSE) License © 2026-PRESENT [Kevin Deng](https://github.com/sxzz)

<!-- Badges -->

[npmx-version-src]: https://npmx.dev/api/registry/badge/version/ts-content-mapper
[npmx-downloads-src]: https://npmx.dev/api/registry/badge/downloads-month/ts-content-mapper
[npmx-href]: https://npmx.dev/ts-content-mapper
[unit-test-src]: https://github.com/sxzz/ts-content-mapper/actions/workflows/unit-test.yml/badge.svg
[unit-test-href]: https://github.com/sxzz/ts-content-mapper/actions/workflows/unit-test.yml
[typescript-pr]: https://github.com/microsoft/TypeScript/pull/63936
