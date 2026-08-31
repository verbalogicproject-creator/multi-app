// Feature flags. Disabled features are hidden from the UI entirely and their
// code paths are unreachable until re-enabled (see production roadmap in README).
export const FEATURES = {
    imageEdit: false,  // needs current image model verified live
    videoGen: false,   // needs Veo 3.1 verified live + poll-loop hardening
    liveAudio: false,  // needs server-side ephemeral tokens (raw key must never reach the browser)
    pyodide: true,     // model-generated Python runs only after explicit user approval
} as const;
