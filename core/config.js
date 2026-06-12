// Config + secrets + canonical paths. Secrets come from env vars first, then an
// optional gitignored state/secrets.json — never from committed config.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const paths = {
  root: ROOT,
  config: join(ROOT, 'config', 'guai.config.json'),
  models: join(ROOT, 'config', 'models.json'),
  db: join(ROOT, 'state', 'guai.db'),
  inbox: join(ROOT, 'state', 'inbox'),
  snapshots: join(ROOT, 'state', 'snapshots'),
  dashboard: join(ROOT, 'state', 'dashboard.html'),
  fixtures: join(ROOT, 'test', 'fixtures'),
  templates: join(ROOT, 'comms', 'templates'),
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function loadConfig() {
  return readJson(paths.config);
}

export function loadModels() {
  return readJson(paths.models);
}

function fileSecrets() {
  const p = join(ROOT, 'state', 'secrets.json');
  return existsSync(p) ? readJson(p) : {};
}

/** Env var wins over the optional secrets file. */
export function secret(name) {
  return process.env[name] ?? fileSecrets()[name] ?? null;
}

export function githubToken() {
  return secret('GITHUB_TOKEN');
}
