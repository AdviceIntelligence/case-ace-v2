import express from 'express';
import type { Request, Response } from 'express';
import { config } from '../config/index.ts';

const Router = express.Router;
export const configRouter = Router();

configRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    environment: config.env,
    gcpRegion: config.gcpRegion,
    gcpProjectId: config.gcpProjectId,
    authProviderType: config.auth.activeProvider,
    sessionTimeoutSeconds: config.auth.idleTimeoutSeconds,
    models: {
      speechToText: 'chirp_2',
      drafting: 'gemini-1.5-pro',
    },
    isSyntheticOnly: config.isSyntheticOnly,
    version: '2.0.0',
  });
});
