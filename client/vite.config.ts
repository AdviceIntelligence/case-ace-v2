import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cspHeader, cspMeta, CSP_PLACEHOLDER } from './src/config/csp.ts';
import type { EnvironmentName } from './src/config/environments.ts';

const VALID_ENVIRONMENTS: readonly EnvironmentName[] = ['local', 'test', 'pilot'];

/**
 * Resolves the target environment for this build.
 *
 * `vite build` requires VITE_APP_ENV to be set explicitly. Falling back to 'local' during a
 * build is how a deployed bundle ends up pointing at http://localhost:8080 with a localhost
 * CSP, which is silent, looks like a working deploy, and breaks every backend call. The dev
 * server may still default to 'local'.
 */
function resolveEnvironment(command: 'build' | 'serve'): EnvironmentName {
  const raw = process.env.VITE_APP_ENV;

  if (!raw) {
    if (command === 'build') {
      throw new Error(
        'VITE_APP_ENV is not set. A production build must name its environment explicitly ' +
          `(one of: ${VALID_ENVIRONMENTS.join(', ')}), e.g. VITE_APP_ENV=pilot npm run build.`,
      );
    }
    return 'local';
  }

  if (!VALID_ENVIRONMENTS.includes(raw as EnvironmentName)) {
    throw new Error(
      `VITE_APP_ENV="${raw}" is not a known environment. Expected one of: ${VALID_ENVIRONMENTS.join(', ')}.`,
    );
  }

  return raw as EnvironmentName;
}

/** Bakes the environment's CSP into the <meta http-equiv> tag in index.html. */
function cspPlugin(envName: EnvironmentName): Plugin {
  return {
    name: 'case-ace-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        if (!html.includes(CSP_PLACEHOLDER)) {
          throw new Error(
            `index.html no longer contains the ${CSP_PLACEHOLDER} placeholder, so no Content ` +
              'Security Policy would be applied to the page. Restore the placeholder.',
          );
        }
        return html.replaceAll(CSP_PLACEHOLDER, cspMeta(envName));
      },
    },
  };
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), geolocation=(), payment=(), usb=(), display-capture=(), microphone=(self)',
} as const;

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const envName = resolveEnvironment(command);

  return {
    plugins: [react(), cspPlugin(envName)],
    server: {
      port: 5173,
      strictPort: true,
      headers: {
        'Content-Security-Policy': cspHeader(envName),
        ...SECURITY_HEADERS,
      },
    },
    preview: {
      port: 4173,
      strictPort: true,
      headers: {
        'Content-Security-Policy': cspHeader(envName),
        ...SECURITY_HEADERS,
      },
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
