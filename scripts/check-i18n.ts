// TC-P4-L10N-02: fails on user-facing text that bypasses the translations.
//
//   npx tsx scripts/check-i18n.ts      (also run by src/i18n/coverage.test.ts in `npm test`)
//
// Scans src/app and src/components (not tests) with the TypeScript parser for
// JSX text containing letters, and string literals with letters in the props
// that show text (title, label, placeholder, body, accessibilityLabel).
// Everything visible must come from t() / msg() in src/i18n.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..');
const DIRS = ['src/app', 'src/components'];
const TEXT_PROPS = new Set(['title', 'label', 'placeholder', 'body', 'accessibilityLabel', 'confirmLabel', 'submitLabel']);
/** Not words: formats, codes and glyphs that read the same in every language. */
const ALLOWED = new Set(['01XXXXXXXXX', 'AGENT001', '0.00', '••••', '—', '›', '·', '+', '−', '৳', 'S']);
const LETTERS = /[A-Za-z]/;

export interface Finding {
  file: string;
  line: number;
  text: string;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

export function findHardcodedText(root = ROOT): Finding[] {
  const findings: Finding[] = [];
  for (const file of DIRS.flatMap((d) => files(join(root, d)))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || ALLOWED.has(trimmed) || !LETTERS.test(trimmed)) return;
      findings.push({
        file: relative(root, file),
        line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: trimmed.slice(0, 60),
      });
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) report(node, node.text);
      if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(source)) && node.initializer) {
        const init = node.initializer;
        if (ts.isStringLiteral(init)) report(init, init.text);
        if (ts.isJsxExpression(init) && init.expression
            && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) {
          report(init, init.expression.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}

if (require.main === module) {
  const findings = findHardcodedText();
  for (const f of findings) console.log(`${f.file}:${f.line}  "${f.text}"`);
  console.log(findings.length ? `FAIL: ${findings.length} hard-coded strings` : 'L10N-02: every UI string goes through t()');
  process.exit(findings.length ? 1 : 0);
}
