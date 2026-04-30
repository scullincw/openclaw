import type { Node as TreeSitterNode } from "web-tree-sitter";
import { detectInterpreterInlineEvalArgv } from "../exec-inline-eval.js";
import { parseBashForCommandExplanation } from "./tree-sitter-runtime.js";
import type {
  CommandContext,
  CommandExplanation,
  CommandRisk,
  CommandShape,
  CommandStep,
} from "./types.js";

type MutableExplanation = {
  shapes: Set<CommandShape>;
  commands: CommandStep[];
  risks: CommandRisk[];
};

function namedChildren(node: TreeSitterNode): TreeSitterNode[] {
  return Array.from({ length: node.namedChildCount }, (_, index) => node.namedChild(index)).filter(
    (child): child is TreeSitterNode => child !== null,
  );
}

function unquote(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function commandNameNode(node: TreeSitterNode): TreeSitterNode | null {
  return (
    node.childForFieldName("name") ??
    namedChildren(node).find((child) => child.type === "command_name") ??
    null
  );
}

function nodeContainsType(node: TreeSitterNode | null, type: string): boolean {
  if (!node) {
    return false;
  }
  if (node.type === type) {
    return true;
  }
  return namedChildren(node).some((child) => nodeContainsType(child, type));
}

function argvFromCommand(node: TreeSitterNode, nameNode: TreeSitterNode): string[] {
  const skipped = new Set<TreeSitterNode>([nameNode, ...namedChildren(nameNode)]);
  const argv = [unquote(nameNode.text)];
  for (const child of namedChildren(node)) {
    if (
      skipped.has(child) ||
      child.type === "command_name" ||
      child.type === "variable_assignment"
    ) {
      continue;
    }
    if (["word", "string", "raw_string", "concatenation"].includes(child.type)) {
      argv.push(unquote(child.text));
    }
  }
  return argv;
}

function recordShape(node: TreeSitterNode, output: MutableExplanation): void {
  if ((node.type === "program" || node.type === "list") && node.text.includes(";")) {
    output.shapes.add("sequence");
  }
  if (node.type === "pipeline") {
    output.shapes.add("pipeline");
  }
  if (node.type === "list") {
    if (node.text.includes("&&")) {
      output.shapes.add("and");
    }
    if (node.text.includes("||")) {
      output.shapes.add("or");
    }
    if (node.text.includes(";")) {
      output.shapes.add("sequence");
    }
  }
  if (node.type === "if_statement") {
    output.shapes.add("if");
  }
  if (node.type === "for_statement") {
    output.shapes.add("for");
  }
  if (node.type === "while_statement") {
    output.shapes.add("while");
  }
  if (node.type === "case_statement") {
    output.shapes.add("case");
  }
  if (node.type === "subshell") {
    output.shapes.add("subshell");
  }
  if (node.type === "compound_statement") {
    output.shapes.add("group");
  }
}

function recordCommandRisks(argv: string[], text: string, output: MutableExplanation): void {
  const executable = argv[0];
  if (!executable) {
    return;
  }
  const inlineEval = detectInterpreterInlineEvalArgv(argv);
  if (inlineEval) {
    output.risks.push({
      kind: "inline-eval",
      command: inlineEval.normalizedExecutable,
      flag: inlineEval.flag,
      text,
    });
  }

  if (["bash", "sh", "zsh", "dash"].includes(executable)) {
    const flagIndex = argv.findIndex((arg) => arg === "-c" || arg === "-lc");
    const payload = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
    if (payload) {
      output.risks.push({
        kind: "shell-wrapper",
        executable,
        flag: argv[flagIndex] ?? "-c",
        payload,
        text,
      });
    }
  }

  if (executable === "find") {
    const flag = argv.find((arg) => ["-exec", "-execdir", "-ok", "-okdir"].includes(arg));
    if (flag) {
      output.risks.push({ kind: "command-carrier", command: executable, flag, text });
    }
  }
  if (executable === "xargs") {
    output.risks.push({ kind: "command-carrier", command: executable, text });
  }
  if (executable === "eval") {
    output.risks.push({ kind: "eval", text });
  }
  if (["sudo", "doas", "env"].includes(executable)) {
    const shellIndex = argv.findIndex((arg) => ["bash", "sh", "zsh", "dash"].includes(arg));
    if (
      shellIndex >= 0 &&
      argv.slice(shellIndex + 1).some((arg) => arg === "-c" || arg === "-lc")
    ) {
      output.risks.push({ kind: "shell-wrapper-through-carrier", command: executable, text });
    }
  }
}

function walk(node: TreeSitterNode, output: MutableExplanation, context: CommandContext): void {
  recordShape(node, output);

  let childContext = context;
  if (node.type === "command_substitution") {
    output.risks.push({ kind: "command-substitution", text: node.text });
    childContext = "command-substitution";
  } else if (node.type === "process_substitution") {
    output.risks.push({ kind: "process-substitution", text: node.text });
    childContext = "process-substitution";
  }

  if (node.type === "command") {
    const nameNode = commandNameNode(node);
    if (nameNode) {
      const hasDynamicName =
        nodeContainsType(nameNode, "command_substitution") ||
        nodeContainsType(nameNode, "process_substitution");
      if (hasDynamicName) {
        output.risks.push({ kind: "dynamic-executable", text: nameNode.text });
      } else {
        const argv = argvFromCommand(node, nameNode);
        const step: CommandStep = {
          context,
          executable: argv[0] ?? "",
          argv,
          text: node.text,
        };
        if (step.executable) {
          output.commands.push(step);
          recordCommandRisks(argv, node.text, output);
        }
      }
    }
  }
  for (const child of namedChildren(node)) {
    walk(child, output, childContext);
  }
}

export async function explainShellCommand(source: string): Promise<CommandExplanation> {
  const tree = await parseBashForCommandExplanation(source);
  const output: MutableExplanation = {
    shapes: new Set(),
    commands: [],
    risks: [],
  };
  walk(tree.rootNode, output, "top-level");
  const topLevelCommands = output.commands.filter((command) => command.context === "top-level");
  return {
    ok: !tree.rootNode.hasError,
    source,
    shapes: [...output.shapes],
    topLevelCommands,
    nestedCommands: output.commands.filter((command) => command.context !== "top-level"),
    risks: output.risks,
  };
}
