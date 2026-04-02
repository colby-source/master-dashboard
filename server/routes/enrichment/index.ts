import { Router } from 'express';
import leadsRouter from './leads';
import pipelineRouter from './pipeline';
import threadsRouter from './threads';
import configRouter from './config';
import analyticsRouter from './analytics';
import testHelpersRouter from './test-helpers';

const router = Router();

router.use(leadsRouter);
router.use(pipelineRouter);
router.use(threadsRouter);
router.use(configRouter);
router.use(analyticsRouter);
router.use(testHelpersRouter);

export default router;
