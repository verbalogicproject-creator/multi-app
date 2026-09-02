/**
 * Pyodide is a Python runtime compiled to WebAssembly — megabytes of it — and it
 * used to be pulled from a CDN by a blocking `<script>` in `index.html`, on
 * every screen, on a phone, for a feature most sessions never reach. It is
 * loaded here instead, the first time a script actually needs to run.
 *
 * The URL is also the app's only cross-origin resource. That is survivable
 * today; it would not be under `COEP: require-corp`, which the preview-runtime
 * decision keeps as a possible future (DESIGN.md §5). If that day comes, this
 * is the one place to change: self-host the runtime or serve it from our own
 * origin. `scripts/audit-ui.mjs` fails on any cross-origin resource, so a
 * regression announces itself.
 */
const PYODIDE_SRC = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';

let scriptPromise: Promise<void> | null = null;

const loadPyodideScript = (): Promise<void> => {
    if ((window as any).loadPyodide) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = PYODIDE_SRC;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            scriptPromise = null;      // let a later attempt retry rather than fail forever
            reject(new Error(`Could not load the Python runtime from ${PYODIDE_SRC}`));
        };
        document.head.appendChild(script);
    });
    return scriptPromise;
};

let pyodide: any = null;
let pyodideLoadingPromise: Promise<any> | null = null;
async function loadPyodideInstance() {
    if (pyodide) return pyodide;
    if (pyodideLoadingPromise) return pyodideLoadingPromise;

    await loadPyodideScript();
    pyodideLoadingPromise = (window as any).loadPyodide();

    try {
        pyodide = await pyodideLoadingPromise;
    } catch (error) {
        console.error("Pyodide failed to initialize:", error);
        pyodideLoadingPromise = null;
        throw error;
    } finally {
        pyodideLoadingPromise = null;
    }
    return pyodide;
}

export const prewarmPyodide = () => {
    console.log("Pre-warming Pyodide environment...");
    loadPyodideInstance().catch(error => {
        console.warn("Pyodide pre-warming failed. It will attempt to load again on first use.", error);
    });
};

export const runPythonScript = async (code: string): Promise<any> => {
    try {
        const py = await loadPyodideInstance();
        if (!py) throw new Error("Pyodide is not available.");
        let stdout = '';
        let stderr = '';
        py.setStdout({ batched: (msg: string) => stdout += msg + '\n' });
        py.setStderr({ batched: (msg: string) => stderr += msg + '\n' });
        let result = null;
        try {
            result = await py.runPythonAsync(code);
        } catch (e: any) {
            stderr += e.toString();
        }
        py.setStdout({});
        py.setStderr({});
        return {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            result: result !== undefined && result !== null ? result.toString() : 'null'
        };
    } catch (error: any) {
        console.error("Error executing Python script:", error);
        return { stdout: "", stderr: error.message || "An unknown error occurred.", result: null };
    }
};
