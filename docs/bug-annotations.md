# Screenshot annotation

Bug-reporting prepares a separate annotated PNG beside eligible raw screenshot
evidence. The raw image, source requirements and execution results remain
unchanged. The shared bug delivery workflow owns uploads and recovery; this
helper performs local preparation and verification only.

## Preparation

`prepareAnnotation(roots, request, dependencies?)` accepts:

- `source`: a selected consumer-relative supported PNG path.
- `sourceSha256`: the exact previously reviewed source hash.
- `output`: a new consumer-relative file under `.harness/runs/<id>/`.
- `summary`, `expected`, `actual`: source-grounded, sanitized annotation text.
- `boxes`: finite relative `{x, y, width, height, kind}` rectangles. `kind` is
  `defect` or an evidence-backed `comparison`; at least one defect box is needed.
- `verification: {relevance: true, privacy: true}`: the caller's review of the
  exact raw image, including its relevance to the reported observation. These
  flags record that review; they do not establish independent reproduction.
- Optional `maxBytes` (default 2 MiB, maximum 8 MiB), `timeoutMs` (default
  15 seconds, maximum 30 seconds) and `correctionCount` (at most two).

The source and derived image are independently bounded and hash-checked. Linked
paths, escapes, source replacement and overwriting an existing output are
rejected. PNG input must be non-interlaced and use grayscale, RGB or RGBA rather
than an indexed palette. CRCs, complete image chunks, inflated pixel lengths and
scanline filters are checked. JPEG is explicitly unavailable at this synchronous
boundary: frame/end markers alone cannot prove decodable pixels. Select an
original supported PNG capture instead. These checks remain separate from the
caller's source review. Installed rendering additionally decodes the raw image
and checks source/output dimensions. `inspectScreenshot(roots, path, sha256,
maximum?)` provides the same synchronous byte/hash/structure checks for raw-only
intake and pre-delivery verification, returning `{bytes, dimensions, mimeType}`.

The renderer uses the package's existing pinned Playwright installation and a
fresh owned headless browser. It installs nothing. The HTML uses inline image
bytes, escaped wrapping labels, automatic text direction, a summary banner and
relative red/green rectangles. External requests are blocked. Rendering and
owned browser cleanup have explicit deadlines; a cleanup failure cannot return
a prepared pair.

The source hash identifies a durable correction history within the report's run
directory. There is one initial placement and at most two changed specifications
for that source; changing output names or supplying a lower correction count
does not reset the history. Unchanged preparation reuses the exact derived file
and receipt without rendering again. A changed specification needs a new output
file. Unsupported rendering, invalid placement, exhausted corrections or failed
output validation return `RAW_ONLY` with a visible reason, after rechecking the
still-eligible source. Stale or ineligible sources do not qualify for fallback.

## Visual review and delivery

`PREPARED` is not a successful visual review. Inspect both exact images and
check the annotation's meaning, placement and privacy. Record that inspection:

```js
const reviewed = bindAnnotationReview(prepared, {
  sourceSha256: prepared.sourceSha256,
  specificationFingerprint: prepared.specificationFingerprint,
  outputSha256: prepared.sha256,
  relevance: true, placement: true, privacy: true
});
const verified = verifyAnnotation(roots, reviewed);
```

The specification fingerprint includes the annotation text, relative geometry,
source dimensions and source-to-output transform. `verifyAnnotation` requires
the exact review binding and rereads both artifacts, checking bytes, hashes and
dimensions. It returns `bytes` for the annotated PNG and `rawBytes` for the source,
with hashes/dimensions. Successful annotation delivers both to the same bug;
`RAW_ONLY` delivers only its still-eligible raw image, with the fallback reason.

The final bug table, field validation, other eligible attachments and raw/derived
pair share one review. Draft or evidence changes invalidate affected checks and
approval; unrelated field edits do not require re-rendering an unchanged valid
image. API/DB-only reports need no screenshot. Neither annotation nor editing
grants permission to execute tests or publish a defect.
