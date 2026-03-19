import { Router } from 'express';
import guideRouter from './exports/guide-docx';
import executiveSummaryRouter from './exports/executive-summary-docx';
import systemOverviewRouter from './exports/system-overview-docx';

const router = Router();

router.use(guideRouter);
router.use(executiveSummaryRouter);
router.use(systemOverviewRouter);

export default router;
