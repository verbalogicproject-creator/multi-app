let pyodide: any = null;
let pyodideLoadingPromise: Promise<any> | null = null;
async function loadPyodideInstance() {
    if (pyodide) return pyodide;
    if (pyodideLoadingPromise) return pyodideLoadingPromise;
    
    // This function is globally available from the pyodide script in index.html
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
