import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { ProgressBar } from 'react-bootstrap';

const CsvBatchImport = () => {
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);

  const onDrop = useCallback((acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file && file.type === 'text/csv') {
      const reader = new FileReader();
      reader.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
        }
      };
      reader.onload = () => {
        // Handle file parsing here
        console.log('File content:', reader.result);
        setUploadProgress(100);
      };
      reader.onerror = () => {
        setError('File reading error');
      };
      reader.readAsText(file);
    } else {
      setError('Invalid file format. Please upload a CSV file.');
    }
  }, []);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
  });

  return (
    <div {...getRootProps()} style={{ border: '2px dashed #007bff', padding: '20px', textAlign: 'center' }}>
      <input {...getInputProps()} />
      <p>Drag 'n' drop some files here, or click to select files</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} />
    </div>
  );
};

export default CsvBatchImport;