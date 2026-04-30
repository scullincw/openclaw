export type CommandContext =
  | "top-level"
  | "command-substitution"
  | "process-substitution"
  | "wrapper-payload"
  | "command-carrier";

export type CommandShape =
  | "pipeline"
  | "and"
  | "or"
  | "sequence"
  | "if"
  | "for"
  | "while"
  | "case"
  | "subshell"
  | "group";

export type CommandStep = {
  context: CommandContext;
  executable: string;
  argv: string[];
  text: string;
};

export type CommandRisk =
  | { kind: "inline-eval"; command: string; flag: string; text: string }
  | { kind: "shell-wrapper"; executable: string; flag: string; payload: string; text: string }
  | { kind: "shell-wrapper-through-carrier"; command: string; text: string }
  | { kind: "command-carrier"; command: string; flag?: string; text: string }
  | { kind: "command-substitution"; text: string }
  | { kind: "process-substitution"; text: string }
  | { kind: "dynamic-executable"; text: string }
  | { kind: "eval"; text: string }
  | { kind: "heredoc"; text: string }
  | { kind: "here-string"; text: string }
  | { kind: "redirect"; text: string }
  | { kind: "syntax-error"; text: string };

export type CommandExplanation = {
  ok: boolean;
  source: string;
  shapes: CommandShape[];
  topLevelCommands: CommandStep[];
  nestedCommands: CommandStep[];
  risks: CommandRisk[];
};
