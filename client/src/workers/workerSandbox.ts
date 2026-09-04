/**
 * workerSandbox
 *
 * Removes the network APIs from a Web Worker's global scope, so that a worker holding raw
 * audio or a non-working transcript has no way to transmit it.
 *
 * This must never run on the main thread. Both worker entry modules previously performed the
 * deletion at module top level behind `typeof self !== 'undefined'`, which is true in a
 * browser window as well, because `self === window` there. `mediaDecoderWorker.ts` is
 * imported for its value exports by `audio/mediaStreamingDecoder.ts`, so the module was
 * evaluated on the main thread during application start-up and deleted `window.fetch`,
 * `window.XMLHttpRequest`, `window.WebSocket` and `window.EventSource` from the page.
 *
 * The page still rendered. The first backend call then failed with "fetch is not defined",
 * which reads like a missing polyfill rather than the application having disarmed itself.
 */

/** True only inside a real Worker global scope, never in a window and never in Node. */
export function isWorkerScope(scope: any = globalThis): boolean {
  if (!scope) return false;

  // A window is the one place this must never fire. Checked first and independently of the
  // WorkerGlobalScope test, so a browser main thread is excluded even if that name is shimmed.
  if (typeof scope.window !== 'undefined' || typeof scope.document !== 'undefined') {
    return false;
  }

  // Module workers have no importScripts, so identity comes from the constructor.
  const WorkerGlobalScopeCtor = scope.WorkerGlobalScope;
  return typeof WorkerGlobalScopeCtor === 'function' && scope instanceof WorkerGlobalScopeCtor;
}

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const;

/**
 * Removes every network API from `scope` when, and only when, `scope` is a Worker global.
 * Returns true if the sandbox was applied. On the main thread this is a no-op returning false.
 */
export function installWorkerNetworkSandbox(scope: any = globalThis): boolean {
  if (!isWorkerScope(scope)) return false;

  for (const name of NETWORK_GLOBALS) {
    try {
      delete scope[name];
    } catch {
      // Non-configurable in some engines: replace with something that fails loudly instead.
    }

    if (typeof scope[name] !== 'undefined') {
      try {
        scope[name] = () => {
          throw new Error(`[Worker Sandbox] Network access via ${name} is prohibited.`);
        };
      } catch {
        // Neither deletable nor writable. The worker is then only as safe as the CSP
        // connect-src allowlist, which is why that allowlist is generated and tested.
      }
    }
  }

  return true;
}

export { NETWORK_GLOBALS };
