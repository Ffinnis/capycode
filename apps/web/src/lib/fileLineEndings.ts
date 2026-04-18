export function normalizeFileContents(contents: string): string {
  return contents.replace(/\r\n/g, "\n");
}

export function serializeFileContents(contents: string, lineEnding: "lf" | "crlf"): string {
  if (lineEnding === "crlf") {
    return contents.replace(/\r?\n/g, "\r\n");
  }
  return contents.replace(/\r\n/g, "\n");
}
