import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => /\.(md|markdown)$/i.test(file))
  .filter(
    (file) =>
      !/(^|\/)(?:CHANGELOG|LICENSE|NOTICE|THIRD[-_]PARTY)(?:[./_-]|$)|^docs\/(?:releases|release-notes)\//i.test(
        file,
      ),
  );
let failed = false;
for (const file of files) {
  const raw = await readFile(resolve(root, file), 'utf8');
  const source = raw
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[^]*?^\s*\1\s*$/gm, '')
    .replace(/`+[^`\n]*`+/g, '');
  const targets = [
    ...source.matchAll(
      /\]\(\s*(?:<([^>]+)>|((?:\\.|[^\s()]|\([^()]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    ),
    ...source.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm),
    ...source.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi),
  ];
  for (const match of targets) {
    const target = (match[1] ?? match[2]).replace(/\\([ ()])/g, '$1');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
    const path = target.split(/[?#]/, 1)[0];
    if (!path) continue;
    try {
      const decoded = decodeURIComponent(path);
      await stat(
        resolve(
          decoded.startsWith('/') ? root : dirname(resolve(root, file)),
          decoded.replace(/^\//, ''),
        ),
      );
    } catch {
      console.error(`${file}: missing or invalid local target ${target}`);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `Documentation links verified in ${files.length} tracked files (anchors not checked).`,
  );
