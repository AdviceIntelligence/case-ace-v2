import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/index.ts';

/**
 * Express middleware enforcing the strict Content Security Policy.
 */
export function cspMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isProd = config.env === 'pilot';
  
  // Script src includes 'wasm-unsafe-eval' for client-side ONNX/WASM ASR/NER execution
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'"].join(' ');
  const connectSrc = config.cspConnectAllowlist.join(' ');

  const cspDirectives = [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'self'",
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), geolocation=(), payment=(), usb=(), display-capture=(), microphone=(self)'
  );

  next();
}
