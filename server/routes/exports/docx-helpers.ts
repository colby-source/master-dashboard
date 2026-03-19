import {
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, bold: true })] });
}

function bodyText(text: string) {
  return new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, size: 22 })] });
}

function bulletPoint(text: string) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text, size: 22 })] });
}

function numberedStep(num: number, title: string, detail: string) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: `${num}. ${title}: `, bold: true, size: 22 }),
      new TextRun({ text: detail, size: 22 }),
    ],
  });
}

export { heading, bodyText, bulletPoint, numberedStep };
