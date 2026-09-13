import { defineConfig } from 'tsup';

/**
 * Bundles the API into one CommonJS file.
 *
 * `@momishop/shared` ships TypeScript source, so it has to be compiled in
 * rather than required at runtime. `jose` and the Mistral SDK are bundled too: they are ESM-only, and
 * loading it with require() would tie the service to a narrow range of Node
 * versions. Everything else stays external and resolves from node_modules.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  noExternal: ['@momishop/shared', 'jose', '@mistralai/mistralai'],
});
