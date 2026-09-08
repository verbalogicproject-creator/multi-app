#!/usr/bin/env node
// Generates ../components-and-modules.json: a real directory walk (never a
// hand-typed file list, which goes stale the moment a file is added or removed)
// merged with purpose statements that are each marked `verified` (grounded in an
// actual read of the cited doc or source file) or explicitly not (inferred from
// the filename alone, and said so) — never presented as if both were the same
// kind of claim. A file with neither is left `null` with level "gap" rather than
// guessed.
//
// Run: node architecture/generate/modules.mjs
// Verify: node architecture/generate/modules.mjs --verify

import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'components-and-modules.json');

const DIRECTORIES = [
    'providers', 'memory', 'auth', 'typecheck', 'preview',
    'components', 'components/builders', 'components/editor', 'components/memory',
    'context', 'hooks', 'services', 'utils', 'types', 'test', 'scripts',
];

// Directory-level purposes, verified against AGENTS.md / CLAUDE.md / README.md,
// which already state these precisely — quoted/paraphrased with a citation, not
// re-derived from scratch.
const DIRECTORY_PURPOSES = {
    'providers': { statement: 'The provider layer: one interface (streamChat/streamJson/generateJson/generateText) over four LLM vendors. catalog.js is the single source of truth for models; generate.js/scaffold.js/salvage.js/aesthetic.js/allowlist.js are the app-builder’s generation strategy specifically.', mechanism: { file: 'CLAUDE.md', line: null, note: 'Provider layer section' }, level: 'lint', verified: true },
    'memory': { statement: 'The server side of the memory system: one GraphMemory per build, and the /api/memory/* surface. proposals.js is the declared table mapping validator issue codes to lessons — a code in neither PROPOSAL_TABLE nor NOT_A_LESSON is logged as an open question.', mechanism: { file: 'AGENTS.md', line: 14, note: 'memory/bridge.js / memory/routes.js / memory/proposals.js' }, level: 'gate', verified: true },
    'auth': { statement: 'Google/GitHub OAuth gating the whole /api surface. The real invariant is bootPosture: "reachable from the network or unauthenticated, but not both."', mechanism: { file: 'CLAUDE.md', line: null, note: 'Auth section' }, level: 'gate', verified: true },
    'typecheck': { statement: 'The server’s tsc runner (runner.js), its output parser (parse.js), and the /api/typecheck surface. Its scratch tree lives at .preview-work/ inside the repo (not /tmp) so tsc resolves the real @types/react.', mechanism: { file: 'AGENTS.md', line: 16 }, level: 'gate', verified: true },
    'preview': { statement: 'The server’s bundler: bundle.js (esbuild over a virtual filesystem), css.js (Tailwind v4 compiled in-process), document.js (the one self-contained document, shimming history/localStorage/document.cookie for the opaque-origin iframe), and the /api/preview surface.', mechanism: { file: 'AGENTS.md', line: 19 }, level: 'gate', verified: true },
    'components': { statement: 'Reusable views. The guided app builder lives under components/builders/; components/editor/ and components/memory/ hold the CodeMirror theme/language config and the memory drawer.', mechanism: { file: 'AGENTS.md', line: 5 }, level: 'lint', verified: true },
    'components/builders': { statement: 'The five-step wizard (Idea/Blueprint/Style/Generate/Export) plus its supporting shelf, step indicator, design-contract preview and Sandpack preview.', mechanism: { file: 'README.md', line: 30 }, level: 'lint', verified: true },
    'components/editor': { statement: 'CodeMirror 6 theme and language-mode config, split out beside CodeEditor.tsx per CONSOLIDATED-PATH.md Stage 1.', mechanism: { file: '~/.claude/plans/CONSOLIDATED-PATH.md', line: 82 }, level: 'lint', verified: true },
    'components/memory': { statement: 'MemoryPanel.tsx — the right-hand drawer (sheet on phone) surfacing what needs human review in the lesson ladder.', mechanism: { file: 'DESIGN.md', line: 21, note: '"Memory panel: Right-hand drawer, sheet on phone"' }, level: 'review', verified: true },
    'context': { statement: 'AppContext.tsx: the builder state machine, candidate promotion, the evidence trail, and the client-side memory taps.', mechanism: { file: 'AGENTS.md', line: 12 }, level: 'gate', verified: true },
    'hooks': { statement: 'Reusable React behavior. useChat.ts attaches a fresh file tree, tsc diagnostics summary, and preview verdict to every coding-mode chat turn, computed fresh each time rather than read from IdeView’s own live state.', mechanism: { file: 'CLAUDE.md', line: null, note: 'IDE / peer-programmer section, for useChat.ts specifically' }, level: 'gate', verified: true },
    'services': { statement: 'HTTP calls and platform integrations. memoryService.ts is the client’s only route to memory — every function answers null rather than throwing, bounded at 2s. buildStorage.ts persists in-progress builder state and the saved-build library (quota-aware, evicts oldest).', mechanism: { file: 'AGENTS.md', line: 9, note: 'services/buildStorage.ts, services/memoryService.ts' }, level: 'gate', verified: true },
    'utils': { statement: 'General helpers, deliberately dependency-free where possible. validateBuild.ts is the model-independent post-generation gate; palettes.ts/designContract.ts are the design tokens and the self-contained HTML preview rendered from them; toolSequence.ts’s splitAtApprovalGate runs the IDE’s tool-call queue.', mechanism: { file: 'AGENTS.md', line: 10, note: 'utils/validateBuild.ts, utils/palettes.ts, utils/designContract.ts' }, level: 'gate', verified: true },
    'types': { statement: 'Domain types, not duplicated outside this directory. project.ts’s Project.origin carries the plan/theme/acceptance-criteria a project was built from.', mechanism: { file: 'CLAUDE.md', line: null, note: 'IDE section, for types/project.ts specifically' }, level: 'lint', verified: true },
    'test': { statement: 'Pipeline-level Vitest specs spanning several modules (generation, the memory ladder) that don’t map to one file to colocate next to — as opposed to colocated *.test.ts beside the module it tests.', mechanism: { file: 'CLAUDE.md', line: null, note: 'Commands section, "Two tiers"' }, level: 'gate', verified: true },
    'scripts': { statement: 'Standalone checks that need a real browser, a spawned server, or a live model — the ok(label, condition, detail) convention, not ported to Vitest because their setup cost (spawn a process, launch Chrome) differs from what npm test should carry by default.', mechanism: { file: 'CLAUDE.md', line: null, note: 'Commands section' }, level: 'gate', verified: true },
};

// File-level purposes for components/**, verified by an actual read pass (see the
// architecture audit session that produced this generator) — not inferred from
// filenames.
const COMPONENT_PURPOSES = {
    "components/AgentManager.tsx": "Renders the Experts list and an inline create/edit form (AgentForm) that binds an agent to a persona and a project, with select/delete actions calling useAppContext's handleAddAgent/handleUpdateAgent/handleDeleteAgent, and a guard screen when no projects or personas exist yet.",
    "components/AiControls.tsx": "The persona/style configuration panel: a Custom Style Editor modal for creating/editing named instruction blocks, a persona loader/save/export/import (JSON) flow, and a 'Persona Composer' that lets the user set base instructions and reorder/weight a list of composed style blocks, plus Web Search and Low Latency toggles.",
    "components/AssistantMessage.tsx": "Renders one assistant chat turn: a collapsible 'Thinking' block, the message's text/image/video parts, action buttons (regenerate video, continue scene, use image, play/stop TTS audio), a raw tool-call JSON dump, and a list of web-search grounding source links.",
    "components/ChatPanel.tsx": "The main chat surface: holds per-mode prompt state (chat/plan/coding/image-edit/video-gen/live), wires useChat/useTTS/useLiveChat hooks, renders the mode selector, message list, and mode-specific input controls (text form, or lazily-loaded ImageEditorPane/VideoGeneratorPane/LiveChatPane), and in 'plan' mode shows a 'Send to Builder' button that seeds the web-app wizard via composeBuilderBrief.",
    "components/CodeBlock.tsx": "A syntax-agnostic code display box with a language label and a 'Copy'/'Copied' clipboard button using navigator.clipboard.",
    "components/CodeEditor.tsx": "A CodeMirror 6-based file editor: builds an EditorView keyed on file.id (to preserve undo history across saves), converts tsc line/col diagnostics into CodeMirror Diagnostic ranges and dispatches them via setDiagnostics, retracts diagnostics on any edit, supports Ctrl/Cmd-S save, syncs external file-content rewrites (e.g. from the model) into the live document, and supports scrolling/cursor-placement via a revealAt prop when a Problems-tab entry is clicked.",
    "components/FileExplorer.tsx": "A project file list/sidebar: lets the user select a file, create a new file (via window.prompt), delete a file (with confirm), shows a per-file type-error count badge (from an errorCounts map), and optionally a close button when rendered as a mobile sheet.",
    "components/Harness.tsx": "A two-tab destination ('Experts' / 'Configuration') that composes AgentManager and AiControls into one screen, keeping both mounted (hidden via CSS, not unmounted) so in-progress edits in either tab survive switching.",
    "components/ImageEditorPane.tsx": "The image-editing input form for chat's image-edit mode: an ImageUpload control, a text prompt field, quick 'style preset' buttons that append canned prompt suffixes, and a submit button gated on having both a prompt and an image (uploaded or externally supplied).",
    "components/ImageUpload.tsx": "A reusable file-upload widget with drag-free <input type=file>, FileReader-based data-URL preview, support for an externally-supplied preview URL that takes precedence/gets cleared on new upload, and a 'Remove' control.",
    "components/LiveChatPane.tsx": "The live-voice-chat control surface: a start/stop listening button pair and an animated 'VoiceVisualizer' (pulsing circle + mic icon) shown only while isListening is true.",
    "components/LoadingIndicator.tsx": "A minimal spinner (SVG animate-spin) with an optional status text line beneath it, used across the app wherever an async operation is in flight.",
    "components/MessageItem.tsx": "Dispatches a single chat Message to the correct renderer by author (system messages render as centered plain text; USER/ASSISTANT/TOOL delegate to UserMessage/AssistantMessage/ToolMessage) and adds an assistant-only avatar glyph; the component is memoized with React.memo.",
    "components/ModeSelector.tsx": "A horizontally-scrolling pill/tab strip for switching the ChatPanel's mode (chat/plan/image-edit/video-gen/live), filtering out modes disabled via utils/features.ts's FEATURES flags.",
    "components/ModelPicker.tsx": "A grouped <select> for choosing the active LLM model (or 'Auto'), reading the model catalog from useAppContext and building per-provider optgroups, with a tooltip showing each model's hint and price.",
    "components/PreviewHost.tsx": "The single shared 'run the generated app' preview component (used by both the wizard's Export step and the IDE): debounce-bundles the project's files via services/buildPreview, renders the result in a sandboxed (allow-scripts only) srcDoc iframe, and separately surfaces three distinct failure states — a build error, a runtime error posted from inside the iframe via postMessage, and an 'app rendered nothing' empty-mount notice.",
    "components/ProjectManager.tsx": "The 'Projects' home screen: a responsive card grid of projects with per-project checkbox (selects the project for both IDE and chat context), buttons to view files, export project as JSON, open ProjectSettingsModal, and delete (with a cost-preview confirmation naming affected files/agents), plus a project-creation input and a sign-out control shown only when auth is enforced.",
    "components/ProjectSettingsModal.tsx": "A responsive dialog (bottom sheet on mobile, centered on desktop) for renaming a project and managing its files — add files via a hidden file input, list/delete existing files — closable via Escape or a backdrop click.",
    "components/QuotaBadge.tsx": "A small status chip showing either 'X requests left today' (free-tier models, turning accent-colored when nearly/fully spent) or an estimated dollar spend (paid models) for whichever model a given surface ('chat' or 'builder') would actually use, computed from a fetched QuotaSnapshot; also exports the modelForSurface/remainingFor/spentOn helper functions reused by Step_Theme.",
    "components/ToolMessage.tsx": "Renders a tool-call result message: for a pending runPython call it shows the proposed code and Run/Skip approval buttons wired to onResolvePendingTool; for a completed runPython call it shows stdout/stderr/error/result plus a 'View Executed Code' disclosure and an inline SaveScriptForm to save the code into a selected project's files; other tool results fall back to a raw JSON dump.",
    "components/UserMessage.tsx": "Renders a user chat turn as a single raised, right-aligned rounded bubble containing the message's text parts (no avatar, per its own comment, since the bubble alone signals authorship).",
    "components/VideoGeneratorPane.tsx": "The video-generation input form for chat's video-gen mode: duration slider, aspect-ratio select, an optional 'Director mode' details panel (shot type/camera movement/artistic style dropdowns), an optional starting-image ImageUpload, a text prompt field, and a submit button.",
    "components/VideoPlayer.tsx": "A thin wrapper rendering an autoplaying, looping, muted <video> element for a given src URL.",
    "components/builders/BuildShelf.tsx": "The web-app builder's landing screen when no build is active: a 'Start a new build' CTA plus a list of previously saved builds (name, file count, relative save time, and validation verdict) with Open/ZIP-export/Delete actions, and a shortcut link to the Projects destination when the user has existing IDE projects.",
    "components/builders/DesignContractPreview.tsx": "Renders the builder's theme tokens (colors/typography) as an actual laid-out HTML document inside a fully sandboxed (sandbox=\"\"), no-script/no-network iframe generated by utils/designContract.ts, measuring its host's width via ResizeObserver and CSS-scaling (not reflowing) the fixed 760px-wide document down to fit.",
    "components/builders/SandpackAppPreview.tsx": "A second, independent live preview of the generated project using CodeSandbox's Sandpack (react-ts template, CDN dependency resolution): remaps the project's own files into Sandpack's expected shape, strips scaffold-owned files (package.json/vite.config/tsconfig/index.html) and Tailwind at-rules/imports, substitutes an @tailwindcss/browser runtime-JIT import for styling, resolves the real entry file, and filters declared dependencies through providers/allowlist.js's PREVIEW_PACKAGES — explicitly documented as never feeding back into the app's own tsc/esbuild validation verdict.",
    "components/builders/StepIndicator.tsx": "A 5-step (Idea/Plan/Theme/Generate/Export) progress indicator rendering completed steps as a filled disc with a checkmark, the current step as a raised disc, and future steps dimmed, connected by rule lines whose brightness (not hue) encodes progress.",
    "components/builders/Step_Export.tsx": "The wizard's final step: shows the generated project's file count and a save/rename form (save or 'save as copy' to the build library), a validation-issues disclosure (errors/warnings by file), both live previews (PreviewHost's esbuild sandbox and the lazily-loaded SandpackAppPreview), Download-as-ZIP and Open-in-IDE buttons, and a collapsible 'build record' evidence log.",
    "components/builders/Step_Generate.tsx": "The wizard's generation-in-progress/result screen: while running shows a spinner and a live list of files as they're written; if generation stopped with no candidate files, shows an error message and the partial file list with a retry/back-to-style option; if a candidate failed validation, lists error/warning issues with 'Generate again' / 'Keep it anyway' / 'Back to style' actions — explicitly never asking the model whether it succeeded.",
    "components/builders/Step_Idea.tsx": "The wizard's first step: a single textarea for the user's app idea and a 'Create project blueprint' submit button that calls generateWebAppPlan, disabled while a plan request is in flight.",
    "components/builders/Step_Plan.tsx": "An editable blueprint review step: normalizes the model-produced (or previously saved) plan into a local DraftPlan, lets the user directly add/edit/remove pages, components, shared data 'entities' (with typed fields) and acceptance-criteria items, offers an 'Ask the AI to revise this blueprint' free-text refine action (refineWebAppPlan), tracks dirty state against the last plan, and an Approve button that commits the draft and advances to the Theme step.",
    "components/builders/Step_Theme.tsx": "The wizard's style step: palette tile grid, per-role custom color pickers (switches to a synthetic 'Custom' palette on edit), typography tile grid, 'design variety' aesthetic-dimension pill pickers plus anti-slop/self-reflection checkboxes, a live DesignContractPreview of the current tokens, an AI 'suggest 3 art directions' feature (each rendered as its own DesignContractPreview card), and a 'Generate My Web App' button that first estimates/cost-warns (paid model $ estimate, or free-tier quota-remaining warning) before calling generateWebAppCode.",
    "components/builders/WebAppBuilder.tsx": "The wizard's outer shell/router: renders BuildShelf when inactive or the step component matching builderState.currentStep (Step_Idea/Step_Plan/Step_Theme/Step_Generate/Step_Export) inside a scrolling container, shows the StepIndicator and a sticky 'Reset' button only while a build is active, and dims content to 50% opacity while a step's async status.isLoading is true.",
};

function walk(relDir) {
    const abs = path.join(ROOT, relDir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs)
        .filter((name) => statSync(path.join(abs, name)).isFile())
        .filter((name) => /\.(tsx?|jsx?|mjs)$/.test(name))
        .sort();
}

function buildInventory() {
    const directories = DIRECTORIES.map((dir) => {
        const purposeEntry = DIRECTORY_PURPOSES[dir] ?? null;
        const files = walk(dir).map((name) => {
            const relPath = path.join(dir, name).replace(/\\/g, '/');
            const known = COMPONENT_PURPOSES[relPath];
            if (known) return { file: name, purpose: known, verified: true, mechanism: { file: relPath, line: null, note: 'read directly during the architecture audit' } };
            return { file: name, purpose: null, verified: false, level: 'gap', note: 'not yet read for this audit — do not infer from the filename' };
        });
        return {
            path: dir + '/',
            declaration: purposeEntry ?? { statement: null, level: 'gap', note: 'directory not yet documented anywhere cited' },
            fileCount: files.length,
            files,
        };
    });
    return {
        $schema: 'declaration-v1',
        generatedBy: 'architecture/generate/modules.mjs',
        generatedFrom: 'fs walk of known source directories (file list) + AGENTS.md/CLAUDE.md/README.md citations (directory purposes) + a targeted read pass for components/** (file purposes)',
        note: 'A file with verified:false is a gap, not a guess — its purpose is genuinely unknown to this document, not inferred from its name.',
        directories,
    };
}

const output = buildInventory();
const json = JSON.stringify(output, null, 2) + '\n';

if (process.argv.includes('--verify')) {
    if (!existsSync(OUT)) { console.error('FAIL components-and-modules.json does not exist'); process.exit(1); }
    const onDisk = readFileSync(OUT, 'utf8');
    if (onDisk === json) { console.log('ok components-and-modules.json matches the current file tree'); process.exit(0); }
    console.error('FAIL components-and-modules.json is stale against the current file tree — re-run: node architecture/generate/modules.mjs');
    process.exit(1);
}

writeFileSync(OUT, json);
const totalFiles = output.directories.reduce((n, d) => n + d.fileCount, 0);
const totalVerified = output.directories.reduce((n, d) => n + d.files.filter(f => f.verified).length, 0);
console.log(`wrote ${path.relative(ROOT, OUT)} (${totalFiles} files across ${output.directories.length} directories, ${totalVerified} with a verified purpose)`);
