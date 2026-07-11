const MAX_DEPTH = 256;

/** Parses JSON while rejecting duplicate keys, floats, unsafe integers, and trailing data. */
export function parseStrictIntegerJson(text: string): unknown {
  let cursor = 0;

  const whitespace = (): void => {
    while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/.test(text[cursor] ?? "")) {
      cursor += 1;
    }
  };

  const value = (depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Error("JSON nesting limit exceeded");
    whitespace();
    const token = text[cursor];
    if (token === "{") return object(depth + 1);
    if (token === "[") return array(depth + 1);
    if (token === '"') return string();
    if (token === "t" && text.slice(cursor, cursor + 4) === "true") {
      cursor += 4;
      return true;
    }
    if (token === "f" && text.slice(cursor, cursor + 5) === "false") {
      cursor += 5;
      return false;
    }
    if (token === "n" && text.slice(cursor, cursor + 4) === "null") {
      cursor += 4;
      return null;
    }
    return integer();
  };

  const object = (depth: number): Record<string, unknown> => {
    cursor += 1;
    whitespace();
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (text[cursor] === "}") {
      cursor += 1;
      return output;
    }
    while (cursor < text.length) {
      whitespace();
      if (text[cursor] !== '"') throw new Error("object key must be a JSON string");
      const key = string();
      if (keys.has(key)) throw new Error("duplicate JSON key: " + key);
      keys.add(key);
      whitespace();
      if (text[cursor] !== ":") throw new Error("object key is missing a value separator");
      cursor += 1;
      output[key] = value(depth);
      whitespace();
      if (text[cursor] === "}") {
        cursor += 1;
        return output;
      }
      if (text[cursor] !== ",") throw new Error("object entry is missing a separator");
      cursor += 1;
    }
    throw new Error("unterminated JSON object");
  };

  const array = (depth: number): unknown[] => {
    cursor += 1;
    whitespace();
    const output: unknown[] = [];
    if (text[cursor] === "]") {
      cursor += 1;
      return output;
    }
    while (cursor < text.length) {
      output.push(value(depth));
      whitespace();
      if (text[cursor] === "]") {
        cursor += 1;
        return output;
      }
      if (text[cursor] !== ",") throw new Error("array item is missing a separator");
      cursor += 1;
    }
    throw new Error("unterminated JSON array");
  };

  const string = (): string => {
    const start = cursor;
    cursor += 1;
    while (cursor < text.length) {
      const token = text[cursor];
      if (token === '"') {
        cursor += 1;
        return JSON.parse(text.slice(start, cursor)) as string;
      }
      if (token === "\\") {
        cursor += 2;
      } else {
        const code = text.charCodeAt(cursor);
        if (code < 0x20) throw new Error("unescaped control character in JSON string");
        cursor += 1;
      }
    }
    throw new Error("unterminated JSON string");
  };

  const integer = (): number => {
    const start = cursor;
    if (text[cursor] === "-") cursor += 1;
    if (text[cursor] === "0") {
      cursor += 1;
      if (/\d/.test(text[cursor] ?? "")) throw new Error("leading zero in JSON integer");
    } else {
      if (!/[1-9]/.test(text[cursor] ?? "")) throw new Error("invalid JSON value");
      while (/\d/.test(text[cursor] ?? "")) cursor += 1;
    }
    if ([".", "e", "E"].includes(text[cursor] ?? "")) {
      throw new Error("floating-point JSON is forbidden");
    }
    const parsed = Number(text.slice(start, cursor));
    if (!Number.isSafeInteger(parsed)) throw new Error("unsafe JSON integer");
    return parsed;
  };

  const parsed = value(0);
  whitespace();
  if (cursor !== text.length) throw new Error("trailing data after JSON value");
  return parsed;
}
