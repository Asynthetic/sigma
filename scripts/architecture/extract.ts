import { posix } from "node:path";
import ts from "typescript";

export function scanFrontend(path: string, source: string) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const options: ts.CompilerOptions = { noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === path ? ast : undefined);
  const checker = ts.createProgram([path], options, host).getTypeChecker();

  const imports: string[] = [];
  const invokeBindings = new Set<ts.Symbol>();
  const commands = new Set<string>();
  const workers = new Set<string>();

  for (const node of ast.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      continue;
    const clause = node.importClause;
    const bindings = clause?.namedBindings;
    const named =
      bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
    const runtime = named.filter((binding) => !binding.isTypeOnly);
    if (
      clause?.isTypeOnly ||
      (named.length > 0 && !runtime.length && !clause?.name)
    )
      continue;

    const specifier = node.moduleSpecifier.text;
    imports.push(specifier);
    if (specifier === "@tauri-apps/api/core") {
      for (const binding of runtime) {
        if ((binding.propertyName ?? binding.name).text === "invoke") {
          const symbol = checker.getSymbolAtLocation(binding.name);
          if (symbol) invokeBindings.add(symbol);
        }
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = checker.getSymbolAtLocation(node.expression);
      if (binding && invokeBindings.has(binding)) {
        const name = node.arguments[0];
        if (!name || !ts.isStringLiteralLike(name)) {
          throw new Error(
            `${path}: use a literal Tauri command or extend the architecture extractor`,
          );
        }
        commands.add(name.text);
      }
    }
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(ast) === "Worker" &&
      !checker.getSymbolAtLocation(node.expression)
    ) {
      const url = node.arguments?.[0];
      if (
        url &&
        ts.isNewExpression(url) &&
        url.expression.getText(ast) === "URL"
      ) {
        const [specifier, base] = url.arguments ?? [];
        if (
          specifier &&
          ts.isStringLiteralLike(specifier) &&
          base?.getText(ast) === "import.meta.url"
        ) {
          workers.add(resolveSpecifier(path, specifier.text));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(ast);
  return { imports, commands, workers };
}

export function resolveSpecifier(path: string, specifier: string) {
  if (specifier.startsWith("."))
    return posix.normalize(posix.join(posix.dirname(path), specifier));
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  return specifier;
}

// The MVP accepts the repository's plain generate_handler! list and command attributes.
export function registeredCommands(source: string) {
  const lists = [
    ...source.matchAll(
      /^\s*\.invoke_handler\(\s*tauri::generate_handler!\s*\[([^\]]*)\]/gm,
    ),
  ];
  if (lists.length !== 1)
    throw new Error("Expected one Tauri generate_handler! list");

  const entries = lists[0][1]
    .replace(/\/\/[^\n]*/g, "")
    .trim()
    .replace(/,$/, "")
    .split(",")
    .map((entry) => entry.trim());
  if (
    entries.some((entry) => !/^\w+(?:::\w+)*$/.test(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error("Invalid or duplicate Tauri generate_handler! entries");
  }
  return entries;
}

export function declaredCommands(source: string) {
  const declarations = source.matchAll(
    /^\s*#\[tauri::command\]\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
  );
  return Array.from(declarations, (match) => match[1]);
}
