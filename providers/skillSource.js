// Filesystem-backed skill/model-prompt content — the seam this plan's own
// unified-memory design calls a `SkillSource`: retrievable, injectable prompt
// chunks for the Harness, sourced from real `SKILL.md`-shaped files rather than
// invented. Deliberately dependency-free (no YAML library): every file here uses
// the same three-field, single-line frontmatter Claude Code's own skills and
// Google's `gemini-skills` repo both use, so a hand-rolled parser is honest
// about what this actually supports rather than pretending to be a general
// YAML/Markdown loader.
//
// Filesystem-first now, on purpose: a later `MemorySkillSource` implementing the
// same shape (`list`/`get`) could back this with multi-graph-memory once real
// usage justifies that coupling — not attempted here, same reasoning
// declaration-guard used to defer its own context-os integration.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/;

/**
 * Parses the flat, single-line-value frontmatter this repo's skills use.
 * Not a YAML parser: a value spanning multiple lines, or a nested structure,
 * is out of scope by design — every file under `skills/` is written flat on
 * purpose, and a skill that needs more than this should not silently succeed
 * with a truncated field.
 */
const parseFrontmatter = (text) => {
    const match = text.match(FRONTMATTER_RE);
    if (!match) return null;
    const [, rawFrontmatter, body] = match;
    const fields = {};
    for (const line of rawFrontmatter.split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key) fields[key] = value;
    }
    return { fields, body: body.trim() };
};

/** One skill directory -> its parsed content, or a named failure. */
const readSkillFile = (dir, id) => {
    const path = join(dir, id, 'SKILL.md');
    let text;
    try {
        text = readFileSync(path, 'utf-8');
    } catch (error) {
        return { id, error: `Could not read ${path}: ${error.message}` };
    }
    const parsed = parseFrontmatter(text);
    if (!parsed) return { id, error: `${path} has no valid --- frontmatter block.` };
    const { name, description, kind } = parsed.fields;
    if (!name || !description || !kind) {
        return { id, error: `${path} is missing a required frontmatter field (need name, description, kind — got ${Object.keys(parsed.fields).join(', ') || 'none'}).` };
    }
    if (kind !== 'skill' && kind !== 'model-prompt') {
        return { id, error: `${path} has kind: "${kind}" — must be "skill" or "model-prompt".` };
    }
    if (name !== id) {
        return { id, error: `${path}'s frontmatter name "${name}" does not match its directory "${id}" — the id must be unambiguous from the path alone.` };
    }
    return { id, name, description, kind, body: parsed.body, path };
};

/** Every subdirectory of `dir` that contains a SKILL.md, in a stable (sorted) order. */
const skillIds = (dir) => {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((id) => {
            try {
                return statSync(join(dir, id, 'SKILL.md')).isFile();
            } catch {
                return false;
            }
        })
        .sort();
};

/**
 * Reads every skill under `dir`. Returns `{ skills, failed }` rather than
 * throwing on the first bad file — one malformed SKILL.md must not hide every
 * other one, the same discipline `declaration-guard`'s `stamp_all` already
 * uses for the same reason.
 */
export const listSkills = (dir) => {
    const skills = [];
    const failed = [];
    for (const id of skillIds(dir)) {
        const result = readSkillFile(dir, id);
        if (result.error) failed.push(result);
        else skills.push({ id: result.id, name: result.name, description: result.description, kind: result.kind });
    }
    return { skills, failed };
};

/** Full content for one skill, including its body — `null` if absent or malformed. */
export const getSkill = (dir, id) => {
    if (!skillIds(dir).includes(id)) return null;
    const result = readSkillFile(dir, id);
    return result.error ? null : result;
};
