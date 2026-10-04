import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Previews are shrunk to this width, never enlarged */
const PREVIEW_MAX_WIDTH = 800;
const RENDER_TIMEOUT_MS = 60_000;
const MAX_PNG_SIZE = 64 * 1024 * 1024;

/**
 * Renders one page (1-based) of a PDF to a PNG with GraphicsMagick, which the
 * docker images ship along with ghostscript. The PDF is streamed to a temp
 * file rather than buffered, as books can weigh hundreds of megabytes.
 */
export async function renderPdfPageToPng(
  pdf: NodeJS.ReadableStream,
  pageNumber: number,
): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "karakeep-pdf-preview-"));
  try {
    const input = path.join(dir, "input.pdf");
    await pipeline(pdf, createWriteStream(input));
    const { stdout } = await execFileAsync(
      "gm",
      [
        "convert",
        "-density",
        "100",
        `${input}[${pageNumber - 1}]`,
        "-resize",
        `${PREVIEW_MAX_WIDTH}x>`,
        "png:-",
      ],
      {
        encoding: "buffer",
        maxBuffer: MAX_PNG_SIZE,
        timeout: RENDER_TIMEOUT_MS,
      },
    );
    if (stdout.byteLength === 0) {
      throw new Error(`Page ${pageNumber} rendered to an empty image`);
    }
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
