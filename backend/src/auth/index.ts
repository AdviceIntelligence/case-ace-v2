import type { AuthConfig, AuthProvider } from './types.ts';
import { EntraIdProvider } from './entraIdProvider.ts';
import { TotpProvider } from './totpProvider.ts';

export type * from './types.ts';
export * from './jwt.ts';
export * from './entraIdProvider.ts';
export * from './totpProvider.ts';

export function createAuthProvider(config: AuthConfig, environmentName: string = 'local'): AuthProvider {
  if (config.enableEntraId && config.enableTotp) {
    throw new Error(
      'Security Configuration Error: Mutually exclusive auth providers (Entra ID and TOTP) cannot both be enabled simultaneously. Configuration must fail closed.'
    );
  }

  if (!config.enableEntraId && !config.enableTotp) {
    throw new Error(
      'Security Configuration Error: No authentication provider is enabled. System fails closed.'
    );
  }

  if ((environmentName === 'pilot' || environmentName === 'production') && config.enableTotp) {
    throw new Error(
      'Security Policy Violation: Fallback TOTP authentication is strictly forbidden in the pilot and production environments once Entra ID is live.'
    );
  }

  if (config.enableEntraId) {
    return new EntraIdProvider(config);
  }

  if (config.enableTotp) {
    return new TotpProvider(config);
  }

  throw new Error('Security Configuration Error: Invalid auth configuration state.');
}
