import type { Request, Response, NextFunction } from 'express';
import type { AuthProvider, AuthUser, UserRole } from '../auth/types.ts';

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function createAuthMiddleware(authProvider: AuthProvider) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header.' });
      return;
    }

    const token = authHeader.slice(7).trim();
    const user = await authProvider.verifyToken(token);

    if (!user) {
      res.status(401).json({ error: 'Invalid or expired access token.' });
      return;
    }

    req.user = user;
    next();
  };
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated request.' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: User role '${req.user.role}' is not authorized to access this resource. Required: [${allowedRoles.join(', ')}]`,
      });
      return;
    }

    next();
  };
}
