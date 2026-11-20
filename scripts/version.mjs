#!/usr/bin/env node
// Versionnement commun de Pôle Jeunesse (admin, mobile, paquet partagé).
// Même mécanisme que LE HUB (scripts/version.mjs de ce dépôt-là), adapté à un
// monorepo npm workspaces : un seul package-lock.json à la racine.
//
// Source de vérité unique : le fichier VERSION à la racine du dépôt
// (MAJOR.MINOR.PATCH). Les champs "version" des package.json (racine et
// workspaces) et leurs copies dans package-lock.json n'en sont que des
// copies synchronisées par ce script.
//
// Usage (depuis n'importe où dans le dépôt) :
//   node scripts/version.mjs check            vérifie la cohérence (CI)
//   node scripts/version.mjs patch|minor|major prépare la version suivante
//   node scripts/version.mjs X.Y.Z            prépare une version explicite
//
// Ne crée jamais de commit, de tag ni de push, et ne touche à aucune
// dépendance : seuls les champs "version" sont réécrits.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// '' = paquet racine ; les autres sont les workspaces npm.
const APPS = ['', 'apps/admin', 'apps/mobile', 'packages/shared'];
const LOCKFILE = 'package-lock.json';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_FILE = 'VERSION';
const CHANGELOG_FILE = 'CHANGELOG.md';

class VersionError extends Error {}
const fail = (msg) => { throw new VersionError(msg); };

const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');

function parseSemver(v) {
  const m = SEMVER.exec(v);
  if (!m) fail(`version invalide « ${v} » (attendu : MAJOR.MINOR.PATCH, ex. 1.2.3)`);
  return m.slice(1).map(Number);
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

function readVersion() {
  if (!existsSync(join(ROOT, VERSION_FILE))) fail(`${VERSION_FILE} introuvable à la racine du dépôt`);
  const v = readText(VERSION_FILE).trim();
  parseSemver(v);
  return v;
}

// Lit un JSON en exigeant qu'il soit déjà au format que JSON.stringify
// (indentation 2, saut de ligne final) reproduit à l'identique : sinon la
// réécriture changerait autre chose que la version, et on préfère refuser.
function readJsonStrict(rel) {
  const text = readText(rel);
  const data = JSON.parse(text);
  if (JSON.stringify(data, null, 2) + '\n' !== text) {
    fail(`${rel} n'est pas au format JSON standard (indentation 2) — réécriture refusée pour ne rien modifier d'autre que la version`);
  }
  return data;
}

// Fichiers synchronisés : { chemin, lecture de version(s), écriture }.
// Le lockfile unique porte une entrée par workspace (packages["apps/admin"]…)
// en plus de l'entrée racine (packages[""] et le champ "version" de tête).
function versionedFiles() {
  const paquets = APPS.map((app) => ({
    path: app ? `${app}/package.json` : 'package.json',
    versions: (d) => [d.version],
    apply: (d, v) => { d.version = v; },
  }));
  const verrou = {
    path: LOCKFILE,
    versions: (d) => [d.version, ...APPS.map((app) => d.packages?.[app]?.version)],
    apply: (d, v) => {
      d.version = v;
      for (const app of APPS) {
        if (!d.packages?.[app]) fail(`${LOCKFILE} : entrée packages["${app}"] absente`);
        d.packages[app].version = v;
      }
    },
  };
  return [...paquets, verrou];
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function changelogHasVersion(v) {
  if (!existsSync(join(ROOT, CHANGELOG_FILE))) return false;
  const escaped = v.replace(/\./g, '\\.');
  return new RegExp(`^## \\[${escaped}\\]`, 'm').test(readText(CHANGELOG_FILE));
}

// ---------------------------------------------------------------- check
function check() {
  const version = readVersion();
  const errors = [];

  for (const f of versionedFiles()) {
    let data;
    try {
      data = readJsonStrict(f.path);
    } catch (e) {
      errors.push(e.message);
      continue;
    }
    for (const found of f.versions(data)) {
      if (found !== version) errors.push(`${f.path} : version « ${found} » ≠ ${VERSION_FILE} « ${version} »`);
    }
  }

  if (!changelogHasVersion(version)) {
    errors.push(`${CHANGELOG_FILE} : aucune section « ## [${version}] » — compléter le changelog avant de publier`);
  }

  // Un tag vX.Y.Z posé sur HEAD doit correspondre à VERSION. Silencieux si
  // git ou les tags ne sont pas disponibles (ex. checkout superficiel en CI).
  try {
    const tags = git(['tag', '--points-at', 'HEAD']).split('\n').filter((t) => /^v\d/.test(t));
    for (const t of tags) {
      if (t !== `v${version}`) errors.push(`tag ${t} posé sur HEAD alors que ${VERSION_FILE} vaut ${version}`);
    }
  } catch { /* pas de dépôt git : rien à vérifier */ }

  if (errors.length) {
    console.error('Incohérences de version :');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Versions cohérentes : ${version} (${APPS.map((a) => a || 'racine').join(', ')}).`);
}

// ---------------------------------------------------------------- bump
function nextVersion(current, arg) {
  const [maj, min, pat] = parseSemver(current);
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (SEMVER.test(arg)) return arg;
  fail(`argument invalide « ${arg} » (attendu : patch, minor, major ou MAJOR.MINOR.PATCH)`);
}

function assertVersionUnused(current, target) {
  if (compareSemver(target, current) <= 0) {
    fail(`${target} n'est pas supérieure à la version actuelle ${current}`);
  }
  const tag = `v${target}`;
  let localTag = '';
  try { localTag = git(['tag', '--list', tag]); } catch { /* pas de git */ }
  if (localTag) fail(`le tag ${tag} existe déjà localement`);

  // Tags distants : vérifiés si le remote répond, sans jamais bloquer
  // la préparation hors ligne (le tag local reste contrôlé ci-dessus et
  // `git push` refusera de toute façon un tag distant déjà existant).
  try {
    const remote = execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000,
    }).trim();
    if (remote) fail(`le tag ${tag} existe déjà sur le dépôt distant`);
  } catch (e) {
    if (e instanceof VersionError) throw e;
    console.warn(`Avertissement : tags distants non vérifiés (remote injoignable) — ${tag} contrôlé localement seulement.`);
  }

  if (changelogHasVersion(target)) fail(`${CHANGELOG_FILE} contient déjà une section « ## [${target}] »`);
}

function assertFilesClean(paths) {
  let dirty = '';
  try {
    dirty = git(['status', '--porcelain', '--', ...paths]);
  } catch {
    fail('impossible de lire l\'état git — exécuter le script depuis le dépôt');
  }
  if (dirty) {
    fail(`modifications non commitées sur les fichiers de version — les commiter ou les annuler d'abord :\n${dirty}`);
  }
}

function writeAtomic(rel, content) {
  const abs = join(ROOT, rel);
  const tmp = `${abs}.version-tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, abs);
}

function bump(arg) {
  const current = readVersion();
  const target = nextVersion(current, arg);
  const files = versionedFiles();

  assertFilesClean([VERSION_FILE, ...files.map((f) => f.path)]);
  assertVersionUnused(current, target);

  // Tout est calculé et validé avant la première écriture : une erreur
  // sur un fichier ne laisse pas les autres à moitié mis à jour.
  const outputs = files.map((f) => {
    const data = readJsonStrict(f.path);
    f.apply(data, target);
    return [f.path, JSON.stringify(data, null, 2) + '\n'];
  });
  outputs.push([VERSION_FILE, `${target}\n`]);
  for (const [path, content] of outputs) writeAtomic(path, content);

  console.log(`Version préparée : ${current} → ${target}`);
  console.log(`Fichiers modifiés : ${outputs.map(([p]) => p).join(', ')}`);
  console.log('\nÉtapes suivantes (rien n\'a été commité, tagué ni poussé) :');
  console.log(`  1. Dans ${CHANGELOG_FILE}, déplacer le contenu de « À venir » sous « ## [${target}] - AAAA-MM-JJ ».`);
  console.log('  2. node scripts/version.mjs check, puis les vérifications du README (types, tests, build).');
  console.log('  3. Commit + pull request, relecture, fusion dans main.');
  console.log(`  4. Tag annoté sur le commit fusionné : git tag -a v${target} -m "Pôle Jeunesse ${target}" <commit>`);
}

// ---------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (rest.length) fail(`argument inattendu : ${rest.join(' ')}`);
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log('Usage : node scripts/version.mjs check | patch | minor | major | X.Y.Z');
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === 'check') check();
  else bump(cmd);
} catch (e) {
  if (e instanceof VersionError) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
  throw e;
}
