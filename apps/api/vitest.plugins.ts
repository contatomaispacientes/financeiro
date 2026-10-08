import type { Plugin } from 'vitest/config';
import ts from 'typescript';

// esbuild does not emit decorator metadata, which NestJS DI relies on (ADR-012).
export function typescriptDecorators(): Plugin {
  return {
    name: 'typescript-decorators',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.ts') || id.includes('node_modules')) return null;
      const out = ts.transpileModule(code, {
        fileName: id,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          sourceMap: true,
          inlineSources: true,
        },
      });
      return { code: out.outputText, map: out.sourceMapText ?? null };
    },
  };
}
