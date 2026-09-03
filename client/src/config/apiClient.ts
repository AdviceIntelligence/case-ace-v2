/**
 * apiClient
 *
 * The single place the client works out where the backend is.
 *
 * The SPA and the API are served from different hosts:
 *   SPA  https://caseace.adviceintelligence.tech      (Firebase Hosting, static files)
 *   API  https://api.caseace.adviceintelligence.tech  (Firebase Hosting, rewritten to Cloud Run)
 *
 * A relative request such as fetch('/api/v1/auth/login') therefore resolves against the SPA
 * host, where the single page application rewrite answers every unmatched path with
 * index.html. The caller receives an HTML document, HTTP 200, and fails while parsing it as
 * JSON. In local development the same relative request goes to the Vite dev server on port
 * 5173, which has no proxy to the backend on 8080, and fails in the same way.
 *
 * Every backend call must go through this module.
 */

import { environment } from './environments.ts';

/** Resolves an API path against the environment's backend origin. */
export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${environment.apiBaseUrl}${suffix}`;
}

/** fetch(), with the backend origin applied. Semantics are otherwise unchanged. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
