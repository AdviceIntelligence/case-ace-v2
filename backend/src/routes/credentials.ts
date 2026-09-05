import express from 'express';
import type { Response } from 'express';
import type { AuthProvider } from '../auth/types.ts';
import { createAuthMiddleware, requireRole } from '../middleware/rbac.ts';
import type { AuthenticatedRequest } from '../middleware/rbac.ts';
import { CredentialIssuerService } from '../services/credentialIssuer.ts';
import type { CredentialPurpose } from '../services/credentialIssuer.ts';

const Router = express.Router;

export function createCredentialsRouter(authProvider: AuthProvider) {
  const router = Router();
  const requireAuth = createAuthMiddleware(authProvider);

  router.post(
    '/issue',
    requireAuth,
    requireRole('adviser', 'supervisor'),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { purpose, ttlSeconds } = req.body || {};

        if (!purpose) {
          res.status(400).json({
            error: 'Missing required field: purpose. Must be "speech-to-text" or "vertex-ai".',
          });
          return;
        }

        const credential = await CredentialIssuerService.issueCredential(
          req.user!,
          purpose as CredentialPurpose,
          typeof ttlSeconds === 'number' ? ttlSeconds : undefined
        );

        res.status(200).json(credential);
      } catch (err: any) {
        res.status(400).json({
          error: err.message,
        });
      }
    }
  );

  return router;
}
