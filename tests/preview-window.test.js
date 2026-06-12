import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("app.js", "utf8");
const html = readFileSync("index.html", "utf8");
const css = readFileSync("styles.css", "utf8");
const previewRoute = readFileSync("app/api/order-documents/[id]/preview/route.js", "utf8");
const backend = readFileSync("lib/platform-db.js", "utf8");

test("preview window is near full screen on desktop and full screen on mobile", () => {
  assert.match(css, /\.pdf-preview-panel[\s\S]*width: 95vw;[\s\S]*height: 95vh;/);
  assert.match(css, /@media[\s\S]*\.pdf-preview-panel[\s\S]*width: 100vw;[\s\S]*height: 100vh;/);
});

test("preview toolbar exposes fit and zoom controls", () => {
  for (const control of ["page-width", "page-fit", "100", "125", "150"]) {
    assert.match(html, new RegExp(`data-pdf-zoom="${control}"`));
  }
  assert.match(html, /data-toggle-pdf-thumbnails/);
  assert.match(html, /pdf-preview-thumbnails/);
});

test("PDF preview defaults to first page and fit width, not 65 percent", () => {
  assert.match(app, /pdfPreviewZoom: "page-width"/);
  assert.match(app, /#page=1&zoom=/);
  assert.match(app, /pdfPreviewSource\(url, "page-width"\)/);
  assert(!app.includes('pdfPreviewZoom: "65"'));
  assert(!app.includes("zoom=65"));
});

test("preview supports PDF and common image content types", () => {
  for (const mimeType of ["application/pdf", "image/jpeg", "image/png", "image/webp"]) {
    assert.match(app, new RegExp(mimeType.replace("/", "\\/")));
    assert.match(backend, new RegExp(mimeType.replace("/", "\\/")));
  }
  assert.match(previewRoute, /"Content-Type": contentType/);
});

test("double click zoom cycles through readable zoom levels", () => {
  assert.match(app, /addEventListener\("dblclick"/);
  assert.match(app, /const zoomCycle = \["100", "150", "200"\]/);
});
