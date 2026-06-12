// Seed a demo project + watch target so a `--dry` sweep has an active project to
// gate findings against. Safe to re-run (upserts).
import { openMemory } from '../core/memory.js';
import { paths } from '../core/config.js';

const mem = openMemory(paths.db);
mem.upsertProject({ name: 'Demo', repos: ['me/repo'], summary: 'Fixture project for the dry-run pipeline.' });
mem.addWatchTarget({ kind: 'github_repo', ref: 'me/repo' });
console.log('Seeded demo project "Demo" watching me/repo.');
mem.close();
