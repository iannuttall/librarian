export function sliceDocument(content: string, sliceParam: string): string {
  const parts = sliceParam.split(":").map((value) => value.trim());
  if (parts.length !== 2) {
    throw new Error("slice must be start:end");
  }
  const startLine = Number(parts[0]);
  const endLine = Number(parts[1]);
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) {
    throw new Error("slice must be start:end");
  }
  if (endLine < startLine) {
    throw new Error("slice end must be >= start");
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const maxLines = 400;
  const maxBytes = 4096;

  const span = endLine - startLine;
  if (span >= maxLines) {
    throw new Error(`slice cannot exceed ${maxLines} lines`);
  }

  const normalizedStart = Math.max(1, startLine);
  const normalizedEnd = Math.max(normalizedStart, endLine);
  if (normalizedStart > totalLines) {
    throw new Error("slice start exceeds document length");
  }

  const clampedEnd = Math.min(normalizedEnd, totalLines);
  const selected = lines.slice(normalizedStart - 1, clampedEnd);
  const payload = selected.join("\n");
  if (Buffer.byteLength(payload, "utf8") > maxBytes) {
    throw new Error(`slice cannot exceed ${maxBytes} bytes`);
  }

  return payload;
}
