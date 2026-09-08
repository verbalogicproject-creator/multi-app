#!/usr/bin/env node
// Validates every skill under skills/ has well-formed SKILL.md frontmatter
// (name, description, kind — kind is "skill" or "model-prompt", name matches
// the directory) before it ships. Mirrors architecture/generate/*.mjs's own
// --verify convention: no write, exit 1 on any failure, one line per problem
// rather than a stack trace.
//
// Run: node scripts/skills/validate.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSkills } from '../../providers/skillSource.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

const { skills, failed } = listSkills(SKILLS_DIR);

if (failed.length > 0) {
    console.error(`${failed.length} skill(s) failed validation:`);
    for (const f of failed) console.error(`  ${f.id}: ${f.error}`);
}

console.log(`${skills.length} skill(s) valid${failed.length ? `, ${failed.length} failed` : ''}.`);
for (const s of skills) console.log(`  ${s.id} (${s.kind}) — ${s.description.slice(0, 72)}${s.description.length > 72 ? '…' : ''}`);

process.exit(failed.length > 0 ? 1 : 0);
