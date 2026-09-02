import React, { useState, useRef, useEffect } from 'react';

interface ImageUploadProps {
  onFileSelect: (file: File | null) => void;
  label: string;
  externalPreviewUrl?: string | null;
  onClearExternalPreview?: () => void;
}

const ImageUpload: React.FC<ImageUploadProps> = ({ onFileSelect, label, externalPreviewUrl, onClearExternalPreview }) => {
  const [internalPreview, setInternalPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const preview = externalPreviewUrl || internalPreview;

  useEffect(() => {
    // If an external preview is provided, clear any internal one.
    if (externalPreviewUrl) {
      setInternalPreview(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [externalPreviewUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    // When a user uploads a file, it takes precedence.
    onClearExternalPreview?.();
    const file = event.target.files?.[0] || null;
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setInternalPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      onFileSelect(file);
    } else {
      setInternalPreview(null);
      onFileSelect(null);
    }
  };
  
  const handleRemove = () => {
      setInternalPreview(null);
      onClearExternalPreview?.();
      onFileSelect(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
  }

  return (
    /* The preview is always a data: or blob: URL — the server converts every
       generated image and video before it reaches the browser, and uploads go
       through FileReader. Nothing here is ever fetched cross-origin. */
    <div className="w-full max-w-xs relative">
      <label htmlFor="file-upload" className="block text-xs font-medium uppercase tracking-[0.12em] text-metal-300 mb-2">{label}</label>
      <div className="mt-1 flex justify-center px-6 py-5 rounded-card
                      shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
        <div className="space-y-2 text-center">
          {preview ? (
            <img src={preview} alt="Selected image preview" className="mx-auto h-24 w-auto rounded-lg" />
          ) : (
            <svg className="mx-auto h-10 w-10 text-metal-400" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <div className="flex items-center justify-center text-sm text-metal-300">
            <label htmlFor="file-upload"
              className="tap flex items-center justify-center relative cursor-pointer rounded-lg px-3 font-medium text-metal-100
                         transition-colors duration-200 ease-fluid md:hover:bg-metal-700">
              <span>Choose a file</span>
              <input ref={fileInputRef} id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept="image/*" />
            </label>
          </div>
          <p className="meta text-[11px]">png · jpg · gif · up to 10 MB</p>
          {preview && (
             <button onClick={handleRemove}
               className="tap px-3 rounded-lg text-xs text-metal-300
                          transition-colors duration-200 ease-fluid md:hover:text-accent md:hover:bg-metal-700">
               Remove
             </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageUpload;
