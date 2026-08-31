import PO from "pofile";
import { Token, tokenize, TokenKind } from "./tokenizer.js";
import { CommentOptions, KeywordMapping } from "../typeDefs.js";
import { assertIsDefined } from "../utilities.js";

type BaseMsg = { message: string; messagePlural?: string; context?: string };

export type MsgInfo = BaseMsg & {
  lineNumber: number;
  extractedComments?: string[];
};

type MsgInfoWithCharIdx = BaseMsg & { idx: number };

export function parseFunctionCall(mapping: KeywordMapping, tokens: Token[]): MsgInfoWithCharIdx[] {
  let idx = -1;
  let t: Token | undefined = undefined;

  function advance() {
    idx += 1;
    return tokens[idx];
  }

  const msgs: MsgInfoWithCharIdx[] = [];

  while (true) {
    t = advance();
    if (!t) {
      break;
    }

    if (t.kind !== TokenKind.Keyword) {
      continue;
    }
    assertIsDefined(t.value);
    const keyword = t.value;
    const charIndex = t.idx;
    if (tokens[idx + 1]?.kind !== TokenKind.ParenLeft) {
      // not a function call
      continue;
    }
    t = advance();
    t = advance();
    const stringArgs: string[] = [];

    // parse strings arguments
    while (true) {
      if (!t || t.kind !== TokenKind.String) {
        break;
      }
      assertIsDefined(t.value);
      stringArgs.push(t.value);
      t = advance();
      if (!t) {
        break;
      }
      if (t.kind !== TokenKind.Comma) {
        break;
      }
      t = advance();
      if (!t) {
        break;
      }
    }

    if (stringArgs.length) {
      const info = getMsgInfo(mapping, keyword, charIndex, stringArgs);
      if (info) {
        msgs.push(info);
      }
    }
  }

  return msgs;
}

function getMsgInfo(
  mapping: KeywordMapping,
  keyword: string,
  charIdx: number,
  stringArgs: string[],
): MsgInfoWithCharIdx | null {
  if (mapping.simple?.includes(keyword)) {
    return {
      message: stringArgs[0],
      idx: charIdx,
    };
  }

  if (mapping.plural?.includes(keyword)) {
    return {
      message: stringArgs[0],
      messagePlural: stringArgs[1],
      idx: charIdx,
    };
  }
  if (mapping.ctx?.includes(keyword)) {
    if (!stringArgs[1]) {
      return null;
    }
    return {
      context: stringArgs[0],
      message: stringArgs[1],
      idx: charIdx,
    };
  }
  if (mapping.ctxPlural?.includes(keyword)) {
    if (!stringArgs[1]) {
      return null;
    }
    return {
      context: stringArgs[0],
      message: stringArgs[1],
      messagePlural: stringArgs[2],
      idx: charIdx,
    };
  }

  throw new Error(`no mapping found for keyword "${keyword}", please report this error`);
}

export function getKeywords(keywords?: KeywordMapping, overrideDefaults = false): KeywordMapping {
  if (overrideDefaults) {
    if (!keywords) {
      throw new Error(`overrideDefaults is enabled but no keywords provided in config`);
    }
    return keywords;
  }
  // merge with defaults
  return {
    simple: ["$gettext", ...(keywords?.simple ? keywords.simple : [])],
    plural: ["$ngettext", ...(keywords?.plural ? keywords.plural : [])],
    ctxPlural: ["$npgettext", ...(keywords?.ctxPlural ? keywords.ctxPlural : [])],
    ctx: ["$pgettext", ...(keywords?.ctx ? keywords.ctx : [])],
  };
}

function commentOptionsWithDefaults(options?: CommentOptions): Required<CommentOptions> {
  if (
    options?.otherLineLeading === undefined &&
    options?.sameLineLeading === undefined &&
    options?.sameLineTrailing === undefined
  ) {
    return {
      otherLineLeading: false,
      sameLineLeading: true,
      sameLineTrailing: true,
    };
  }

  return {
    otherLineLeading: options?.otherLineLeading ?? false,
    sameLineLeading: options?.sameLineLeading ?? false,
    sameLineTrailing: options?.sameLineTrailing ?? false,
  };
}

function commentText(comment: string): string | undefined {
  const lineComment = comment.match(/^\/\/\s*(.*?)\s*$/s);
  if (lineComment) {
    return lineComment[1];
  }

  const blockComment = comment.match(/^\/\*\s*(.*?)\s*\*\/$/s);
  if (blockComment && !blockComment[1].includes("\n")) {
    return blockComment[1];
  }

  return undefined;
}

function sameLineLeadingComment(source: string): string | undefined {
  let delimiter: string | undefined;
  let escaped = false;
  let lastComment: { end: number; source: string } | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (delimiter) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === delimiter) {
        delimiter = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      delimiter = character;
      continue;
    }

    if (character === "/" && source[index + 1] === "/") {
      lastComment = { end: source.length, source: source.slice(index) };
      break;
    }

    if (character === "/" && source[index + 1] === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd === -1) {
        break;
      }
      lastComment = { end: commentEnd + 2, source: source.slice(index, commentEnd + 2) };
      index = commentEnd + 1;
    }
  }

  if (!lastComment || source.slice(lastComment.end).trim()) {
    return undefined;
  }
  return commentText(lastComment.source);
}

function leadingComments(src: string, callIndex: number, options: Required<CommentOptions>): string[] {
  const lineStart = src.lastIndexOf("\n", callIndex - 1) + 1;
  const comments: string[] = [];

  if (options.sameLineLeading) {
    const text = sameLineLeadingComment(src.slice(lineStart, callIndex));
    if (text) {
      comments.push(text);
    }
  }

  if (options.otherLineLeading) {
    const precedingLines = src.slice(0, lineStart).split("\n");
    if (precedingLines[precedingLines.length - 1] === "") {
      precedingLines.pop();
    }

    const precedingComments: string[] = [];
    for (let lineIndex = precedingLines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const line = precedingLines[lineIndex].trim();
      const text = commentText(line);
      if (!text) {
        break;
      }
      precedingComments.unshift(text);
    }
    comments.unshift(...precedingComments);
  }

  return comments;
}

function callEndIndex(src: string, callIndex: number): number | undefined {
  const openParenIndex = src.indexOf("(", callIndex);
  if (openParenIndex === -1) {
    return undefined;
  }

  let depth = 0;
  let delimiter: string | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openParenIndex; index < src.length; index += 1) {
    const character = src[index];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && src[index + 1] === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (delimiter) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === delimiter) {
        delimiter = undefined;
      }
      continue;
    }

    if (character === "/" && src[index + 1] === "/") {
      lineComment = true;
      index += 1;
    } else if (character === "/" && src[index + 1] === "*") {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'" || character === "`") {
      delimiter = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return undefined;
}

function trailingComments(src: string, callIndex: number): string[] {
  const endIndex = callEndIndex(src, callIndex);
  if (endIndex === undefined) {
    return [];
  }

  const lineEnd = src.indexOf("\n", endIndex);
  const remainder = src.slice(endIndex, lineEnd === -1 ? src.length : lineEnd);
  const comment = remainder.match(/^[\s,;)]*(\/\/.*|\/\*.*?\*\/)/)?.[1];
  const text = comment && commentText(comment);
  return text ? [text] : [];
}

function extractComments(src: string, callIndex: number, options?: CommentOptions): string[] {
  const normalizedOptions = commentOptionsWithDefaults(options);
  const comments = leadingComments(src, callIndex, normalizedOptions);
  if (normalizedOptions.sameLineTrailing) {
    comments.push(...trailingComments(src, callIndex));
  }
  return comments;
}

/** Careful: API is not stable */
export function parseSrc(
  src: string,
  options?: { mapping?: KeywordMapping; overrideDefaults?: boolean; comments?: CommentOptions },
): MsgInfo[] {
  const keywords = getKeywords(options?.mapping, options?.overrideDefaults);

  const tokens = tokenize(keywords, src);
  const msgs = parseFunctionCall(keywords, tokens);
  return msgs.map((info): MsgInfo => {
    const i: Omit<MsgInfoWithCharIdx, "idx"> = { ...info };
    const extractedComments = extractComments(src, info.idx, options?.comments);
    // @ts-expect-error
    delete i.idx;
    return {
      ...i,
      lineNumber: src.substring(0, info.idx).split("\n").length,
      ...(extractedComments.length ? { extractedComments } : {}),
    };
  });
}

/** Careful: API is not stable */
export function makePO(fileName: string, msgs: MsgInfo[]): PO {
  const po = new PO();

  for (const msg of msgs) {
    const item = new PO.Item();
    item.msgid = msg.message;
    item.msgid_plural = msg.messagePlural;
    item.msgctxt = msg.context;
    item.references = [`${fileName}:${msg.lineNumber}`];
    item.extractedComments = msg.extractedComments ?? [];
    po.items.push(item);
  }

  return po;
}
