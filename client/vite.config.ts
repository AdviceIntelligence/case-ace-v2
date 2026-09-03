import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' http://localhost:8080 ws://localhost:5173; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self';",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), display-capture=(), microphone=(self)'
    }
  },
  preview: {
    port: 4173,
    strictPort: true,
    headers: {
      'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self' data:; img-src 'self' data:; connect-src 'self' http://localhost:8080; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self';",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=(), display-capture=(), microphone=(self)'
    }
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  }
});
