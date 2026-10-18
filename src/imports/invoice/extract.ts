// Text lines from a PDF, page by page, with pdf.js (the library behind
// Firefox's PDF viewer). Items on the same baseline become one line, read
// left to right; the parsers work on these lines.

export interface PdfJs {
  getDocument(src: { data: Uint8Array; verbosity?: number }): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
}
interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

export async function pdfLines(pdfjs: PdfJs, data: Uint8Array): Promise<string[][]> {
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const pages: string[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim());
    const rows: { y: number; items: TextItem[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      const row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (row) row.items.push(it);
      else rows.push({ y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y); // top of the page first
    pages.push(
      rows.map((r) => {
        const sorted = r.items.sort((a, b) => a.transform[4] - b.transform[4]);
        let line = '';
        let end = -Infinity;
        for (const it of sorted) {
          const x = it.transform[4];
          line += (line && x - end > 1.5 ? ' ' : '') + it.str;
          end = x + it.width;
        }
        return line.replace(/\s+/g, ' ').trim();
      }),
    );
  }
  return pages;
}
