import express from 'express';
import type { Request, Response } from 'express';
import { config } from '../config/index.ts';

const Router = express.Router;
export const healthRouter = Router();

healthRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    environment: config.env,
    gcpRegion: config.gcpRegion,
    isSyntheticOnly: config.isSyntheticOnly,
    timestamp: new Date().toISOString(),
  });
});
