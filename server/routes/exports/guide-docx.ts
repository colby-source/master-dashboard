import { Router, Request, Response } from 'express';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import { guideSections } from '../../data/guide-sections';
import { heading, bodyText, bulletPoint, numberedStep } from './docx-helpers';
import { createLogger } from '../../utils/logger';
const log = createLogger('guide-docx');

const router = Router();

router.get('/guide.docx', async (_req: Request, res: Response) => {
  try {
    const sections = guideSections.flatMap((section) => {
      const paragraphs: Paragraph[] = [
        heading(section.title, HeadingLevel.HEADING_2),
        bodyText(section.description),
        new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'Step-by-Step:', bold: true, size: 22 })] }),
        ...section.steps.map((step, i) => numberedStep(i + 1, step.title, step.detail)),
      ];

      if (section.aiCommands.length > 0) {
        paragraphs.push(
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: 'AI Commands:', bold: true, size: 22, italics: true })] }),
          ...section.aiCommands.map((cmd) => bulletPoint(`"${cmd}"`)),
        );
      }

      paragraphs.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      return paragraphs;
    });

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [new TextRun({ text: 'Master Dashboard — User Guide', bold: true, size: 36 })],
            }),
            bodyText(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Quick Start', HeadingLevel.HEADING_1),
            numberedStep(1, 'Select a Company', 'From the sidebar dropdown (or "All Companies" for a global view).'),
            numberedStep(2, 'Check the Dashboard', 'For alerts, active campaigns, and tasks due today.'),
            numberedStep(3, 'Review Contacts', 'Browse enriched leads, check AI scores, and approve hot leads for outreach.'),
            numberedStep(4, 'Use the AI Assistant', 'Type natural language commands to control everything without clicking through menus.'),
            new Paragraph({ spacing: { after: 200 }, children: [] }),

            heading('Feature Guide', HeadingLevel.HEADING_1),
            ...sections,
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=Master_Dashboard_Guide.docx');
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    log.error('[Exports] Guide generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate guide document' });
  }
});

export default router;
