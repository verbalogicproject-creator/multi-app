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
    <div className="w-full max-w-xs relative">
      <label className="block text-sm font-medium text-gray-400 mb-2">{label}</label>
      <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md">
        <div className="space-y-1 text-center">
          {preview ? (
            <img src={preview} alt="Preview" className="mx-auto h-24 w-auto rounded" />
          ) : (
            <svg className="mx-auto h-12 w-12 text-gray-500" stroke="currentColor" fill="none" viewBox="0 0 48 48" aria-hidden="true">
              <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          <div className="flex text-sm text-gray-500">
            <label htmlFor="file-upload" className="relative cursor-pointer bg-gray-800 rounded-md font-medium text-indigo-400 hover:text-indigo-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-800 focus-within:ring-indigo-500 px-1">
              <span>Upload a file</span>
              <input ref={fileInputRef} id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept="image/*" />
            </label>
            <p className="pl-1">or drag and drop</p>
          </div>
          <p className="text-xs text-gray-600">PNG, JPG, GIF up to 10MB</p>
          {preview && (
             <button onClick={handleRemove} className="mt-2 text-xs text-red-400 hover:text-red-300">Remove</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageUpload;
