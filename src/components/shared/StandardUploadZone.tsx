import * as React from 'react';
import { Upload, CheckCircle2, Circle, X, FileSpreadsheet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';

const trackUpload = (f: File) =>
  track('file_uploaded', { sizeKb: Math.round(f.size / 1024), ext: f.name.split('.').pop()?.toLowerCase() ?? '' });

interface StandardUploadZoneProps {
  onFileSelect: (file: File) => void;
  selectedFile?: { name: string; size: number } | null;
  onClear?: () => void;
  expectedSheets?: string[];
  detectedSheets?: string[];
  inputId?: string;
  primaryText?: string;
  helperText?: string;
  formats?: string[];
  minHeight?: number;
  /** Set to false to suppress the inline "How it works" stepper. Defaults to true for back-compat. */
  showHowItWorks?: boolean;
}

const DEFAULT_FORMATS = ['.xlsx', '.xls', '.csv', '.zip'];

export const StandardUploadZone: React.FC<StandardUploadZoneProps> = ({
  onFileSelect,
  selectedFile,
  onClear,
  expectedSheets,
  detectedSheets = [],
  inputId = 'std-upload',
  primaryText = 'Drop your Amazon Bulk Operations file here',
  helperText,
  formats = DEFAULT_FORMATS,
  minHeight = 200,
  showHowItWorks = true,
}) => {
  const [isDragging, setIsDragging] = React.useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { onFileSelect(f); trackUpload(f); }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { onFileSelect(f); trackUpload(f); }
  };

  if (selectedFile) {
    return (
      <div className="space-y-3 animate-fade-in">
        <div
          className="flex items-center justify-between"
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderLeft: '3px solid #10B981',
            borderRadius: 10,
            padding: '12px 16px',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-[#F3F4F6] flex items-center justify-center flex-shrink-0">
              <FileSpreadsheet className="w-4 h-4 text-[#9CA3AF]" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <p style={{ fontSize: 14, fontWeight: 600, color: '#111827' }} className="truncate" title={selectedFile.name}>
                {selectedFile.name}
              </p>
              <p className="mt-0.5 font-mono-nums" style={{ fontSize: 12, color: '#9CA3AF' }}>
                {(selectedFile.size / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              Ready
            </span>
            {onClear && (
              <button
                onClick={onClear}
                className="w-6 h-6 rounded-md flex items-center justify-center text-[#9CA3AF] hover:text-[#111827] hover:bg-[#F3F4F6] btn-press"
                aria-label="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onClick={() => document.getElementById(inputId)?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        className={cn('group relative cursor-pointer text-center px-6 py-10 btn-press')}
        style={{
          minHeight,
          borderRadius: 12,
          border: isDragging ? '2px solid #4F6EF7' : '1.5px dashed #D1D5DB',
          background: isDragging ? 'rgba(79, 110, 247, 0.05)' : '#F9FAFB',
          transition: 'border-color 150ms ease, border-style 150ms ease, background-color 150ms ease, transform 150ms ease',
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            e.currentTarget.style.background = 'rgba(79, 110, 247, 0.02)';
            e.currentTarget.style.border = '1.5px dashed #4F6EF7';
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            e.currentTarget.style.background = '#F9FAFB';
            e.currentTarget.style.border = '1.5px dashed #D1D5DB';
          }
        }}
      >
        <input
          id={inputId}
          type="file"
          accept=".xlsx,.xls,.csv,.zip"
          onChange={handleInput}
          className="hidden"
        />

        <div className="mx-auto mb-4 flex items-center justify-center">
          <Upload
            style={{
              width: 40,
              height: 40,
              color: isDragging ? '#4F6EF7' : '#9CA3AF',
              transform: isDragging ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 200ms ease, color 150ms ease',
            }}
            strokeWidth={1.4}
          />
        </div>

        <p style={{ fontSize: 16, fontWeight: 600, color: isDragging ? '#4F6EF7' : '#111827' }}>
          {isDragging ? 'Release to upload' : primaryText}
        </p>
        <p className="mt-1.5" style={{ fontSize: 14, color: '#4F6EF7' }}>
          or <span className="underline underline-offset-2">click to browse</span>
        </p>
        {helperText && (
          <p className="mt-2" style={{ fontSize: 12, color: '#9CA3AF' }}>{helperText}</p>
        )}

        <div className="flex items-center justify-center gap-1.5 mt-5">
          {formats.map((fmt) => (
            <span
              key={fmt}
              className="font-mono-nums"
              style={{ fontSize: 12, background: '#F3F4F6', borderRadius: 4, padding: '2px 8px', color: '#374151' }}
            >
              {fmt}
            </span>
          ))}
        </div>
      </div>

      {expectedSheets && expectedSheets.length > 0 && (() => {
        const useRow = expectedSheets.length <= 2;
        return (
          <div className="px-1">
            <p className="mb-2" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: '#9CA3AF' }}>
              Expected sheets
            </p>
            <div
              className={
                useRow
                  ? 'flex flex-wrap gap-x-8 gap-y-2 py-1'
                  : 'grid grid-cols-2 gap-x-6 gap-y-2'
              }
            >
              {expectedSheets.map((sheet) => {
                const detected = detectedSheets.includes(sheet);
                return (
                  <div key={sheet} className="flex items-center gap-2" style={{ fontSize: 13, color: '#374151' }}>
                    {detected ? (
                      <span
                        className="flex-shrink-0 inline-flex items-center justify-center"
                        style={{ width: 16, height: 16, borderRadius: 999, background: '#10B981' }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    ) : (
                      <span
                        className="flex-shrink-0 inline-block"
                        style={{ width: 16, height: 16, borderRadius: 999, border: '1.5px solid #D1D5DB' }}
                      />
                    )}
                    <span className={detected ? 'text-[#111827]' : ''}>{sheet}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* How it works — inline stepper. Suppressible to avoid duplicates on multi-zone uploaders. */}
      {showHowItWorks && (
        <div className="flex items-center gap-3 pt-3 px-1 flex-wrap" style={{ fontSize: 13, color: '#374151' }}>
          {['Upload bulk file', 'Review bleeders', 'Generate decisions'].map((s, i, arr) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center justify-center font-mono-nums"
                  style={{ width: 20, height: 20, borderRadius: 999, border: '1.5px solid #D1D5DB', background: '#FFFFFF', fontSize: 12, fontWeight: 600, color: '#9CA3AF' }}
                >
                  {i + 1}
                </span>
                <span>{s}</span>
              </div>
              {i < arr.length - 1 && <span style={{ color: '#D1D5DB' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
