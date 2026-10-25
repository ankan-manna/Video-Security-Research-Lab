/**
 * Parses an HLS tag's comma-separated ATTRIBUTE=VALUE list, respecting
 * quoted values that themselves contain commas (e.g. CODECS="avc1.4d401e,mp4a.40.2").
 * A naive `.split(",")` would break on exactly that case.
 */
export function parseAttributeList(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;

  while (i < raw.length) {
    while (i < raw.length && (raw[i] === "," || raw[i] === " ")) i++;
    if (i >= raw.length) break;

    const eqIndex = raw.indexOf("=", i);
    if (eqIndex === -1) break;

    const key = raw.slice(i, eqIndex).trim();
    i = eqIndex + 1;

    let value: string;
    if (raw[i] === '"') {
      const end = raw.indexOf('"', i + 1);
      const closing = end === -1 ? raw.length : end;
      value = raw.slice(i + 1, closing);
      i = end === -1 ? raw.length : end + 1;
    } else {
      const commaIndex = raw.indexOf(",", i);
      value = commaIndex === -1 ? raw.slice(i) : raw.slice(i, commaIndex);
      i = commaIndex === -1 ? raw.length : commaIndex;
    }

    if (key) attrs[key] = value.trim();
  }

  return attrs;
}
