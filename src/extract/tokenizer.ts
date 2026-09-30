import { KeywordMapping } from "../typeDefs.js";

export enum TokenKind {
  ParenLeft = "ParenLeft",
  Comma = "Comma",
  QuotDouble = "QuotDouble",
  QuotSingle = "QuotSingle",
  BackTick = "BackTick",
  String = "String",
  Keyword = "Keyword",
  Unrecognized = "Unrecognized",
}

export type Token = {
  kind: TokenKind;
  idx: number;
  value?: string;
};

/** Careful: API is not stable */
export function tokenize(mapping: KeywordMapping, src: string): Token[] {
  const tokens: Token[] = [];
  let idx = -1;
  let unrecognizedContent = "";

  const keywords = Object.values(mapping).flat();
  const maxKeywordLen = keywords.reduce((prev, curr) => {
    if (curr.length > prev) {
      return curr.length;
    }
    return prev;
  }, 0);

  function advance() {
    idx += 1;
    return src.charAt(idx);
  }

  function addToken(kind: TokenKind, charIndex: number, value?: string) {
    if (unrecognizedContent.trim()) {
      tokens.push({
        kind: TokenKind.Unrecognized,
        idx,
        value: unrecognizedContent,
      });
      unrecognizedContent = "";
    }
    if (value) {
      tokens.push({ kind, idx: charIndex, value });
      return;
    }
    tokens.push({ kind, idx: charIndex });
  }

  function readString(delimiter: string) {
    let content = "";
    let c = advance();

    while (true) {
      if (c === "") {
        console.error(`parsing error, string literal is not closed until end of file`);
        break;
      }
      if (c === delimiter) {
        break;
      }
      if (c === "\\") {
        const escapeStart = idx;
        const escaped = advance();

        switch (escaped) {
          case "b":
            content += "\b";
            break;
          case "f":
            content += "\f";
            break;
          case "n":
            content += "\n";
            break;
          case "r":
            content += "\r";
            break;
          case "t":
            content += "\t";
            break;
          case "v":
            content += "\v";
            break;
          case "0":
            content += "\0";
            break;
          case "\n":
            break;
          case "\r":
            if (src.charAt(idx + 1) === "\n") {
              idx += 1;
            }
            break;
          case "x": {
            const hex = src.slice(idx + 1, idx + 3);
            if (/^[\da-f]{2}$/i.test(hex)) {
              content += String.fromCharCode(parseInt(hex, 16));
              idx += 2;
            } else {
              content += src.slice(escapeStart, idx + 1);
            }
            break;
          }
          case "u": {
            if (src.charAt(idx + 1) === "{") {
              const closingBrace = src.indexOf("}", idx + 2);
              const hex = src.slice(idx + 2, closingBrace);
              const codePoint = parseInt(hex, 16);
              if (closingBrace !== -1 && /^[\da-f]{1,6}$/i.test(hex) && codePoint <= 0x10ffff) {
                content += String.fromCodePoint(codePoint);
                idx = closingBrace;
              } else {
                content += src.slice(escapeStart, idx + 1);
              }
            } else {
              const hex = src.slice(idx + 1, idx + 5);
              if (/^[\da-f]{4}$/i.test(hex)) {
                content += String.fromCharCode(parseInt(hex, 16));
                idx += 4;
              } else {
                content += src.slice(escapeStart, idx + 1);
              }
            }
            break;
          }
          default:
            content += escaped;
        }

        c = advance();
        continue;
      }

      content += c;
      c = advance();
    }
    return content.replace(/\r\n/g, "\n");
  }

  function scanToken() {
    const c = advance();
    switch (c) {
      case "(":
        addToken(TokenKind.ParenLeft, idx);
        break;
      case ",":
        addToken(TokenKind.Comma, idx);
        break;
      case '"':
      case "'":
      case "`":
        // this check prevents parsing string literals that aren't part of a function call
        // improves robustness as it prevents issues with odd numbers
        // but will also parse calls within string literals
        const prevTokenKind = tokens[tokens.length - 1]?.kind;
        if (
          !unrecognizedContent.trim() &&
          (prevTokenKind === TokenKind.ParenLeft || prevTokenKind === TokenKind.Comma)
        ) {
          addToken(TokenKind.String, idx, readString(c));
          break;
        }
      default:
        if (c.match(/\s\n\r/)) {
          break;
        }
        // TODO: too expensive to run on every char?
        const possibleKeyword = src.substring(idx, idx + maxKeywordLen);
        const matchedKeyword = keywords
          .filter((kw) => possibleKeyword.startsWith(kw))
          .reduce(
            (prev, curr) => {
              if (curr.length > (prev?.length ?? 0)) {
                return curr;
              }
              return prev;
            },
            <string | undefined>undefined,
          );
        if (matchedKeyword) {
          addToken(TokenKind.Keyword, idx, matchedKeyword);
          idx += matchedKeyword.length - 1;
          break;
        }

        // unrecognized character, continue
        unrecognizedContent += c;
        break;
    }
  }

  while (idx < src.length) {
    scanToken();
  }

  return tokens;
}
