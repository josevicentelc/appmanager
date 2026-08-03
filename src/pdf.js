const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;
const CONTENT_WIDTH = 499;

const pdfText = (value) => String(value ?? '')
  .replace(/→/g, '->').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/•/g, '-')
  .replace(/[^\x20-\xff]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text, width) {
  const output = [];
  for (const source of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const word of source.split(/\s+/).filter(Boolean)) {
      if (line && `${line} ${word}`.length > width) { output.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    output.push(line || ' ');
  }
  return output;
}

function markdownLines(markdown) {
  const lines = [];
  for (const source of String(markdown ?? '').split(/\r?\n/)) {
    const heading = source.match(/^(#{1,3})\s+(.+)$/);
    const level = heading ? heading[1].length : 0;
    const text = heading ? heading[2] : source.replace(/^[-*]\s+/, '- ');
    const fontSize = level === 1 ? 18 : level === 2 ? 14 : level === 3 ? 12 : 10;
    const leading = level ? fontSize + 7 : 14;
    const width = Math.max(42, Math.floor(CONTENT_WIDTH / (fontSize * 0.53)));
    for (const part of wrap(text, width)) lines.push({ text: part, font: level ? 'F2' : 'F1', fontSize, leading, gap: level ? 5 : 0 });
  }
  return lines;
}

export function markdownPdf(markdown) {
  const pages = [[]]; let y = PAGE_HEIGHT - MARGIN;
  for (const line of markdownLines(markdown)) {
    const required = line.leading + line.gap;
    if (y - required < MARGIN) { pages.push([]); y = PAGE_HEIGHT - MARGIN; }
    y -= line.gap + line.leading;
    pages.at(-1).push(`BT /${line.font} ${line.fontSize} Tf ${MARGIN} ${y} Td (${pdfText(line.text)}) Tj ET`);
  }
  const pageIds = pages.map((_, index) => 3 + index * 2);
  const contentIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  ];
  for (const [index, page] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >> /Contents ${contentIds[index]} 0 R >>`);
    const content = `${page.join('\n')}\n`;
    objects.push(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
  }
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  const chunks = [header]; const offsets = [0]; let offset = header.length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'latin1');
    chunks.push(chunk); offset += chunk.length;
  }
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((position) => `${String(position).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(chunks);
}
