import path from "node:path";
import * as TreeSitter from "web-tree-sitter";

let parserPromise: Promise<TreeSitter.Parser> | null = null;

function resolveWebTreeSitterFile(fileName: string): string {
  return path.resolve(process.cwd(), "node_modules", "web-tree-sitter", fileName);
}

function resolveBashWasmPath(): string {
  return path.resolve(process.cwd(), "node_modules", "tree-sitter-bash", "tree-sitter-bash.wasm");
}

async function loadParser(): Promise<TreeSitter.Parser> {
  await TreeSitter.Parser.init({
    locateFile: resolveWebTreeSitterFile,
  });
  const language = await TreeSitter.Language.load(resolveBashWasmPath());
  const parser = new TreeSitter.Parser();
  parser.setLanguage(language);
  return parser;
}

export function getBashParserForCommandExplanation(): Promise<TreeSitter.Parser> {
  parserPromise ??= loadParser();
  return parserPromise;
}

export async function parseBashForCommandExplanation(source: string): Promise<TreeSitter.Tree> {
  const parser = await getBashParserForCommandExplanation();
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("tree-sitter-bash returned no parse tree");
  }
  return tree;
}
