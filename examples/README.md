# Demo content mapper

This example extracts TypeScript from the `<script>` block of a `.demo` file
and maps it back to the original source.

```bash
pnpm install
pnpm build
pnpm --filter demo-content-mapper-example check
```

To try it in VS Code, open `examples/project` as a trusted workspace and install
the recommended TypeScript Native Preview extension. Open `src/index.ts` first,
then use hover or go-to-definition on values imported from `counter.demo`.
