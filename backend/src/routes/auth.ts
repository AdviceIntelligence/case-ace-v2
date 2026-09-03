import express from 'express';
import type { Request, Response } from 'express';
import type { AuthProvider } from '../auth/types.ts';
import { createAuthMiddleware } from '../middleware/rbac.ts';
import type { AuthenticatedRequest } from '../middleware/rbac.ts';

const Router = express.Router;

export function createAuthRouter(authProvider: AuthProvider) {
  const router = Router();
  const requireAuth = createAuthMiddleware(authProvider);

  const handleTokenExchange = async (req: Request, res: Response) => {
    try {
      const result = await authProvider.authenticate(req.body);
      if (!result.success) {
        const statusCode =
          result.errorCode === 'MFA_REQUIRED'
            ? 403
            : result.errorCode === 'ACCOUNT_LOCKED'
            ? 423
            : 401;

        res.status(statusCode).json({
          error: result.error,
          code: result.errorCode || 'AUTHENTICATION_FAILED',
        });
        return;
      }

      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Authentication processing error',
        message: err.message,
      });
    }
  };

  router.post('/token', handleTokenExchange);
  router.post('/login', handleTokenExchange);

  router.get('/callback', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      res.status(400).json({
        error: String(error),
        description: String(error_description || 'OIDC callback returned an error.'),
      });
      return;
    }

    if (!code) {
      res.status(400).json({ error: 'Missing authorization code in callback query.' });
      return;
    }

    res.status(200).json({
      received: true,
      code: String(code),
      state: state ? String(state) : undefined,
    });
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({ error: 'Missing refreshToken in request body.' });
        return;
      }

      const result = await authProvider.refreshToken(refreshToken);
      if (!result.success) {
        res.status(401).json({
          error: result.error,
          code: result.errorCode || 'TOKEN_EXPIRED',
        });
        return;
      }

      res.status(200).json({
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
    } catch (err: any) {
      res.status(500).json({
        error: 'Token refresh error',
        message: err.message,
      });
    }
  });

  router.get('/session', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.status(200).json({
      authenticated: true,
      user: req.user,
    });
  });

  router.post('/logout', (req: Request, res: Response) => {
    res.status(200).json({
      message: 'Session terminated. In-memory volatile state destroyed.',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
