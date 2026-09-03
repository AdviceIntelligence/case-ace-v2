import fs from 'node:fs';
import path from 'node:path';
import markdownIt from 'markdown-it';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  Header,
  Footer,
  PageNumber
} from 'docx';
import PDFDocument from 'pdfkit';

/**
 * Enterprise DOCX and PDF Document Converter for Citizens Advice Wandsworth (CAW)
 * Converts markdown documentation into professional, audit-grade
 * Microsoft Word (.docx) and Adobe PDF (.pdf) documents.
 */

const md = markdownIt({ html: true, linkify: true, typographer: true });

// Styling Constants
const COLOR_NAVY = '004B87';       // Citizens Advice Primary Brand Navy
const COLOR_ACCENT = '006699';     // Secondary Accent Blue
const COLOR_DARK = '1C355E';       // Dark Slate
const COLOR_TEXT = '222222';       // Charcoal Body Text
const COLOR_MUTED = '64748B';      // Muted Slate
const COLOR_BORDER = 'CBD5E1';     // Light Grey Border
const COLOR_ALT_ROW = 'F8FAFC';    // Table Alternating Row
const COLOR_CODE_BG = 'F1F5F9';    // Code Background

/**
 * Parses markdown-it inline tokens into docx TextRun instances
 */
function inlineTokenToDocxRuns(inlineToken, baseOptions = {}) {
  const runs = [];
  if (!inlineToken) return runs;

  if (!inlineToken.children || inlineToken.children.length === 0) {
    if (inlineToken.content) {
      runs.push(new TextRun({ text: inlineToken.content, font: 'Calibri', size: 21, color: COLOR_TEXT, ...baseOptions }));
    }
    return runs;
  }

  let isBold = baseOptions.bold || false;
  let isItalic = baseOptions.italics || false;
  let isLink = false;

  for (const child of inlineToken.children) {
    if (child.type === 'strong_open') {
      isBold = true;
    } else if (child.type === 'strong_close') {
      isBold = false;
    } else if (child.type === 'em_open') {
      isItalic = true;
    } else if (child.type === 'em_close') {
      isItalic = false;
    } else if (child.type === 'link_open') {
      isLink = true;
    } else if (child.type === 'link_close') {
      isLink = false;
    } else if (child.type === 'code_inline') {
      runs.push(
        new TextRun({
          text: child.content,
          font: 'Consolas',
          size: 19,
          color: '0F172A',
          shading: { type: ShadingType.CLEAR, fill: 'E2E8F0' },
          ...baseOptions
        })
      );
    } else if (child.type === 'softbreak' || child.type === 'hardbreak') {
      runs.push(new TextRun({ break: 1 }));
    } else {
      const text = child.content;
      if (text) {
        runs.push(
          new TextRun({
            text: text,
            font: 'Calibri',
            size: 21,
            color: isLink ? COLOR_ACCENT : (baseOptions.color || COLOR_TEXT),
            bold: isBold || baseOptions.bold,
            italics: isItalic || baseOptions.italics,
            underline: isLink ? { type: 'single' } : undefined,
            ...baseOptions
          })
        );
      }
    }
  }

  return runs;
}

/**
 * Extract plain text from inline token
 */
function inlineTokenToPlainText(inlineToken) {
  if (!inlineToken) return '';
  if (!inlineToken.children || inlineToken.children.length === 0) return inlineToken.content || '';
  return inlineToken.children.map(c => {
    if (c.type === 'softbreak' || c.type === 'hardbreak') return '\n';
    return c.content || '';
  }).join('');
}

/**
 * Convert Markdown text to docx Document
 */
export function markdownToDocxDocument(markdownText, documentTitle = 'Case Ace Document') {
  const tokens = md.parse(markdownText, {});
  const elements = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Headings
    if (token.type === 'heading_open') {
      const level = parseInt(token.tag.substring(1), 10);
      const inlineToken = tokens[i + 1];
      i += 2; // skip inline and heading_close

      let headingLevel = HeadingLevel.HEADING_1;
      let headingSize = 34;
      let headingColor = COLOR_NAVY;
      let spacingBefore = 280;
      let spacingAfter = 120;

      if (level === 2) {
        headingLevel = HeadingLevel.HEADING_2;
        headingSize = 27;
        headingColor = COLOR_ACCENT;
        spacingBefore = 240;
        spacingAfter = 100;
      } else if (level === 3) {
        headingLevel = HeadingLevel.HEADING_3;
        headingSize = 23;
        headingColor = COLOR_DARK;
        spacingBefore = 180;
        spacingAfter = 80;
      } else if (level >= 4) {
        headingLevel = HeadingLevel.HEADING_4;
        headingSize = 21;
        headingColor = '334155';
        spacingBefore = 140;
        spacingAfter = 60;
      }

      elements.push(
        new Paragraph({
          heading: headingLevel,
          spacing: { before: spacingBefore, after: spacingAfter },
          children: inlineTokenToDocxRuns(inlineToken, { bold: true, size: headingSize, color: headingColor })
        })
      );
      continue;
    }

    // Paragraphs
    if (token.type === 'paragraph_open') {
      // Check if inside a list or standalone
      const inlineToken = tokens[i + 1];
      i += 2; // skip inline and paragraph_close

      elements.push(
        new Paragraph({
          spacing: { line: 270, after: 100 },
          children: inlineTokenToDocxRuns(inlineToken)
        })
      );
      continue;
    }

    // Fenced Code Blocks
    if (token.type === 'fence' || token.type === 'code_block') {
      const codeLines = token.content.trimEnd().split('\n');
      elements.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: COLOR_CODE_BG },
                  margins: { top: 120, bottom: 120, left: 160, right: 160 },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                    left: { style: BorderStyle.SINGLE, size: 16, color: COLOR_ACCENT },
                    right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER }
                  },
                  children: codeLines.map(
                    (line) =>
                      new Paragraph({
                        spacing: { line: 230, after: 30 },
                        children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18, color: '1E293B' })]
                      })
                  )
                })
              ]
            })
          ]
        })
      );
      elements.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // Blockquote
    if (token.type === 'blockquote_open') {
      const blockParas = [];
      let alertColor = COLOR_NAVY;
      let alertTitle = '';

      i++;
      while (i < tokens.length && tokens[i].type !== 'blockquote_close') {
        if (tokens[i].type === 'paragraph_open') {
          const inlineToken = tokens[i + 1];
          const text = inlineTokenToPlainText(inlineToken);
          const alertMatch = text.match(/\[!(NOTE|IMPORTANT|WARNING|TIP|CAUTION)\]/i);
          if (alertMatch) {
            const aType = alertMatch[1].toUpperCase();
            if (aType.includes('IMPORTANT') || aType.includes('CAUTION')) {
              alertColor = 'C00000';
              alertTitle = 'IMPORTANT REQUIREMENT';
            } else if (aType.includes('WARNING')) {
              alertColor = 'D97706';
              alertTitle = 'WARNING / NOTICE';
            } else if (aType.includes('TIP')) {
              alertColor = '059669';
              alertTitle = 'RECOMMENDATION';
            } else {
              alertColor = COLOR_NAVY;
              alertTitle = 'NOTE';
            }
          }

          blockParas.push(
            new Paragraph({
              spacing: { line: 260, after: 60 },
              children: inlineTokenToDocxRuns(inlineToken)
            })
          );
          i += 2;
        } else {
          i++;
        }
      }

      elements.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
                  margins: { top: 120, bottom: 120, left: 180, right: 180 },
                  borders: {
                    top: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                    bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER },
                    left: { style: BorderStyle.SINGLE, size: 28, color: alertColor },
                    right: { style: BorderStyle.SINGLE, size: 4, color: COLOR_BORDER }
                  },
                  children: [
                    ...(alertTitle ? [new Paragraph({
                      spacing: { after: 60 },
                      children: [new TextRun({ text: `[!${alertTitle}]`, bold: true, font: 'Calibri', size: 20, color: alertColor })]
                    })] : []),
                    ...blockParas
                  ]
                })
              ]
            })
          ]
        })
      );
      elements.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // Bullet & Numbered Lists
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const isOrdered = token.type === 'ordered_list_open';
      let itemNumber = 1;
      i++;

      while (i < tokens.length && tokens[i].type !== 'bullet_list_close' && tokens[i].type !== 'ordered_list_close') {
        if (tokens[i].type === 'paragraph_open') {
          const inlineToken = tokens[i + 1];
          if (isOrdered) {
            elements.push(
              new Paragraph({
                spacing: { line: 260, after: 60 },
                indent: { left: 400, hanging: 240 },
                children: [
                  new TextRun({ text: `${itemNumber}. `, bold: true, font: 'Calibri', size: 21, color: COLOR_NAVY }),
                  ...inlineTokenToDocxRuns(inlineToken)
                ]
              })
            );
            itemNumber++;
          } else {
            elements.push(
              new Paragraph({
                bullet: { level: 0 },
                spacing: { line: 260, after: 60 },
                children: inlineTokenToDocxRuns(inlineToken)
              })
            );
          }
          i += 2;
        } else {
          i++;
        }
      }
      elements.push(new Paragraph({ spacing: { after: 80 } }));
      continue;
    }

    // Tables
    if (token.type === 'table_open') {
      const tableRows = [];
      let isHeaderRow = false;
      let rowIndex = 0;
      let currentRowCells = [];

      i++;
      while (i < tokens.length && tokens[i].type !== 'table_close') {
        const sub = tokens[i];

        if (sub.type === 'thead_open') {
          isHeaderRow = true;
        } else if (sub.type === 'thead_close') {
          isHeaderRow = false;
        } else if (sub.type === 'tr_open') {
          currentRowCells = [];
        } else if (sub.type === 'th_open' || sub.type === 'td_open') {
          const isTh = sub.type === 'th_open';
          const inlineToken = tokens[i + 1];
          currentRowCells.push(
            new TableCell({
              shading: {
                type: ShadingType.CLEAR,
                fill: isTh ? COLOR_NAVY : rowIndex % 2 === 1 ? 'FFFFFF' : COLOR_ALT_ROW
              },
              margins: { top: 100, bottom: 100, left: 140, right: 140 },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: isTh ? COLOR_NAVY : COLOR_BORDER },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: isTh ? COLOR_NAVY : COLOR_BORDER },
                left: { style: BorderStyle.SINGLE, size: 4, color: isTh ? COLOR_NAVY : COLOR_BORDER },
                right: { style: BorderStyle.SINGLE, size: 4, color: isTh ? COLOR_NAVY : COLOR_BORDER }
              },
              children: [
                new Paragraph({
                  alignment: isTh ? AlignmentType.CENTER : AlignmentType.LEFT,
                  spacing: { line: 260 },
                  children: isTh
                    ? inlineTokenToDocxRuns(inlineToken, { bold: true, color: 'FFFFFF' })
                    : inlineTokenToDocxRuns(inlineToken)
                })
              ]
            })
          );
          i += 2; // skip inline and th_close/td_close
        } else if (sub.type === 'tr_close') {
          if (currentRowCells.length > 0) {
            tableRows.push(new TableRow({ children: currentRowCells, tableHeader: isHeaderRow }));
            rowIndex++;
          }
        }
        i++;
      }

      if (tableRows.length > 0) {
        elements.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows
          })
        );
        elements.push(new Paragraph({ spacing: { after: 140 } }));
      }
      continue;
    }

    // Horizontal Rule
    if (token.type === 'hr') {
      elements.push(
        new Paragraph({
          spacing: { before: 160, after: 160 },
          borders: {
            bottom: { style: BorderStyle.SINGLE, size: 8, color: COLOR_BORDER }
          }
        })
      );
      continue;
    }
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: 'Case Ace v2.0 | Citizens Advice Wandsworth', font: 'Calibri', size: 17, color: COLOR_MUTED })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Official-Sensitive / Governance  |  Page ', font: 'Calibri', size: 17, color: COLOR_MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 17, color: COLOR_MUTED }),
                  new TextRun({ text: ' of ', font: 'Calibri', size: 17, color: COLOR_MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 17, color: COLOR_MUTED }),
                  new TextRun({ text: '  |  Confidential & Impartial', font: 'Calibri', size: 17, color: COLOR_MUTED })
                ]
              })
            ]
          })
        },
        children: elements
      }
    ]
  });
}

/**
 * Convert Markdown text to structured PDF
 */
export function markdownToPdfDocument(markdownText, outputPath, documentTitle = 'Case Ace Document') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 45,
      info: {
        Title: documentTitle,
        Author: 'Citizens Advice Wandsworth',
        Subject: 'Case Ace v2.0 Governance & Operational Specification'
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(outputPath, buffer);
        resolve(buffer);
      } catch (err) {
        reject(err);
      }
    });
    doc.on('error', reject);

    const tokens = md.parse(markdownText, {});

    // Running Header
    doc.fontSize(8).fillColor('#64748B').text('Case Ace v2.0 | Citizens Advice Wandsworth', { align: 'right' });
    doc.moveDown(0.8);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === 'heading_open') {
        const level = parseInt(token.tag.substring(1), 10);
        const inlineToken = tokens[i + 1];
        const text = inlineTokenToPlainText(inlineToken);
        i += 2;

        if (level === 1) {
          doc.moveDown(0.6);
          doc.font('Helvetica-Bold').fontSize(18).fillColor('#004B87').text(text);
          doc.moveDown(0.3);
        } else if (level === 2) {
          doc.moveDown(0.5);
          doc.font('Helvetica-Bold').fontSize(13).fillColor('#006699').text(text);
          doc.moveDown(0.3);
        } else if (level === 3) {
          doc.moveDown(0.4);
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#1C355E').text(text);
          doc.moveDown(0.2);
        } else {
          doc.moveDown(0.3);
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text(text);
          doc.moveDown(0.2);
        }
        continue;
      }

      if (token.type === 'paragraph_open') {
        const inlineToken = tokens[i + 1];
        const text = inlineTokenToPlainText(inlineToken);
        i += 2;

        if (text.trim().length > 0) {
          doc.font('Helvetica').fontSize(9.5).fillColor('#222222').text(text, { lineGap: 2 });
          doc.moveDown(0.3);
        }
        continue;
      }

      if (token.type === 'fence' || token.type === 'code_block') {
        const codeText = token.content.trimEnd();
        doc.font('Courier').fontSize(8).fillColor('#1E293B').text(codeText, { indent: 10, lineGap: 1 });
        doc.moveDown(0.3);
        continue;
      }

      if (token.type === 'hr') {
        doc.moveDown(0.3);
        const y = doc.y;
        doc.strokeColor('#CBD5E1').lineWidth(0.5).moveTo(45, y).lineTo(550, y).stroke();
        doc.moveDown(0.4);
        continue;
      }
    }

    doc.end();
  });
}

/**
 * Main batch runner
 */
async function runBatchConversion() {
  const rootDir = process.cwd();
  const targetDirs = [path.join(rootDir, 'docs'), path.join(rootDir, 'evidence')];

  console.log(`\n================================================================`);
  console.log(`CITIZENS ADVICE WANDSWORTH - CASE ACE v2.0 DOCUMENT CONVERTER`);
  console.log(`Converting all Markdown specifications into .docx and .pdf`);
  console.log(`================================================================\n`);

  function findMdFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    let files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(findMdFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  let allMdFiles = [];
  for (const dir of targetDirs) {
    allMdFiles = allMdFiles.concat(findMdFiles(dir));
  }

  console.log(`Discovered ${allMdFiles.length} markdown documents across /docs and /evidence.\n`);

  let docxCount = 0;
  let pdfCount = 0;

  for (const mdPath of allMdFiles) {
    const relPath = path.relative(rootDir, mdPath);
    const dir = path.dirname(mdPath);
    const baseName = path.basename(mdPath, '.md');
    const docxPath = path.join(dir, `${baseName}.docx`);
    const pdfPath = path.join(dir, `${baseName}.pdf`);

    const content = fs.readFileSync(mdPath, 'utf8');
    const firstLineMatch = content.match(/^#\s+(.+)$/m);
    const documentTitle = firstLineMatch ? firstLineMatch[1].trim() : baseName;

    try {
      // 1. Generate DOCX
      const docxDoc = markdownToDocxDocument(content, documentTitle);
      const buffer = await Packer.toBuffer(docxDoc);
      fs.writeFileSync(docxPath, buffer);
      docxCount++;

      // 2. Generate PDF
      await markdownToPdfDocument(content, pdfPath, documentTitle);
      pdfCount++;

      console.log(`  ✓ [CONVERTED] ${relPath} -> .docx (${Math.round(buffer.length / 1024)} KB) | .pdf (${Math.round(fs.statSync(pdfPath).size / 1024)} KB)`);
    } catch (err) {
      console.error(`  ✗ [ERROR] Failed converting ${relPath}:`, err.message);
    }
  }

  console.log(`\n================================================================`);
  console.log(`BATCH CONVERSION COMPLETE:`);
  console.log(`  • Generated DOCX Word Documents: ${docxCount}`);
  console.log(`  • Generated Adobe PDF Documents:  ${pdfCount}`);
  console.log(`  • Total Formatted Artefacts:     ${docxCount + pdfCount}`);
  console.log(`================================================================\n`);
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('convert-docs.mjs') ||
  process.argv[1].endsWith('convert-docs.js')
);

if (isMain) {
  runBatchConversion().catch(err => {
    console.error('Fatal batch conversion failure:', err);
    process.exit(1);
  });
}
