import { PDFParse } from 'pdf-parse';
import type { APIRequestContext } from '@playwright/test';
import * as allure from 'allure-js-commons';

/**
 * PDF document mechanics (utils family — a "PDF / document parsing" enabler). Wraps
 * pdf-parse v2's PDFParse class behind the same thin-facade shape as ApiActions/DBActions:
 * business classes hand in bytes (or a URL + request context) and get back plain
 * text/counts — no parser or transport types leak upward.
 */

/** The extracted essentials of a PDF document — text plus the embedded-image count. */
export interface PdfDocumentContent {
  text: string;
  pageCount: number;
  /**
   * RASTER XObjects only — vector-drawn artwork counts ZERO. Some renderers emit a
   * given asset (a logo, a signature) as vector art on some documents and raster on
   * others (source-dependent), so never build a brand/asset-presence oracle on this
   * count alone.
   */
  imageCount: number;
}

/**
 * Fetches a PDF's bytes through the caller's request context. Lives here (not in a
 * page class) per iron law 1: transport is a technical mechanic, not business logic.
 */
export async function fetchPdfBytes(request: APIRequestContext, pdfUrl: string): Promise<Buffer> {
  return await allure.step(`Fetch the PDF document bytes from the document service`, async () => {
    const response = await request.get(pdfUrl);
    return await response.body();
  });
}

/**
 * Extracts the text layer (and the embedded-image count) of a PDF buffer. A CID-encoded
 * PDF with ToUnicode CMaps needs a real parser to decode its text — a raw byte-scan
 * does not — which is why this wraps pdf-parse instead of grepping the bytes directly.
 * The image count serves asset-presence asserts (an embedded logo/signature is an image
 * XObject, not text).
 */
export async function extractPdfContent(pdfBytes: Buffer): Promise<PdfDocumentContent> {
  return await allure.step(`Extract the text and image inventory of a PDF document (${pdfBytes.length} bytes)`, async () => {
    const parser = new PDFParse({ data: new Uint8Array(pdfBytes) });
    try {
      const textResult = await parser.getText();
      const imageResult = await parser.getImage().catch(() => null);
      const imageCount = imageResult?.pages?.reduce((n: number, p: { images?: unknown[] }) => n + (p.images?.length ?? 0), 0) ?? 0;
      return {
        text: textResult.text ?? '',
        pageCount: textResult.pages?.length ?? 0,
        imageCount,
      };
    } finally {
      await parser.destroy?.();
    }
  });
}
