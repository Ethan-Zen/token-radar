// Token Radar (make.fun token-radar-01).
//
// One program: it reads the sealed protocol snapshot, prices every protocol that records no token with
// the model in lib/model.ts, writes the ranked board and the dashboard's data beside it, copies the page
// and its screenshots into the output directory, and writes the dossier the judge reads.
//
//   node main.ts                       # the grader's container: /input in, /output out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
//
// Node 22.18 or newer runs a .ts file directly; nothing here needs a package or a build step.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

/** The scorer's caps, as reference/gate.json states them. */
const TEXT_MAX = 65_536;
const DASHBOARD_CAP = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name value` or `--name=value` from the arguments; the fallback when neither is there. */
function option(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

/** Copy the regular files of `from` into `to`, skipping dotfiles; the names it copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const input = option('input', '/input');
const snapshotFile = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapshotFile)) fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory>, or mount the sealed /input`);
const out = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// The snapshot in, the board and the page's data out. Nothing is named by hand: every row comes from
// the file, and the model prices it from the row's own figures.
const snapshot = parseSnapshot(readFileSync(snapshotFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// The page first, then the shots beside it: the dossier names both, and the scorer rebuilds it.
const dashboardFiles = copyDir(join(ROOT, 'dashboard'), join(out, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/index.html is missing from the repository');
const shots = copyDir(join(ROOT, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length}: hand in 3, the board, a protocol page and a filtered view`);
for (const name of shots) if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX, screenshots: SHOT_CAP, dashboard: DASHBOARD_CAP }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows (${radar.stats.early} below the floor), ${radar.live.length} live tokens set aside\n` +
    `token radar: ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard (${dashboardFiles.length} files), ` +
    `screenshots (${shots.length}), ${join(out, 'dossier.json')}\n`,
);
