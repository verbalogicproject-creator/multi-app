import JSZip from 'jszip';

/**
 * Creates a .zip file from a record of file paths and their content.
 * @param files A record where keys are file paths (e.g., "src/App.tsx") and values are the file content.
 * @param projectName The name of the project, used for the zip file name.
 */
export const createProjectZip = async (files: Record<string, string>, projectName: string): Promise<void> => {
    const zip = new JSZip();

    for (const [path, content] of Object.entries(files)) {
        zip.file(path, content);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.toLowerCase().replace(/\s+/g, '_')}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
