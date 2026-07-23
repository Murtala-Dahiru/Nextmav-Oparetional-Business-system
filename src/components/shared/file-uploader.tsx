'use client';

import { useState, useRef, useCallback } from 'react';
import {
  UploadCloud, FileText, Image as ImageIcon, Film, FileArchive, File,
  X, CheckCircle2, AlertCircle, Eye, Download, Trash2, RotateCcw,
  Loader2, Sparkles, HardDrive, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  version: number;
  status: 'uploading' | 'completed' | 'error' | 'deleted';
  progress: number;
  error?: string;
}

interface FileUploaderProps {
  maxSizeMB?: number;
  allowedTypes?: string[];
  maxFiles?: number;
  onFilesChanged?: (files: UploadedFile[]) => void;
  initialFiles?: UploadedFile[];
  compact?: boolean;
}

export function FileUploader({
  maxSizeMB = 50,
  allowedTypes = ['pdf', 'png', 'jpg', 'jpeg', 'csv', 'docx', 'xlsx', 'zip'],
  maxFiles = 10,
  onFilesChanged,
  initialFiles = [],
  compact = false,
}: FileUploaderProps) {
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles);
  const [isDragging, setIsDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return ImageIcon;
    if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return Film;
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return FileArchive;
    return FileText;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleUpload = useCallback(
    (rawFiles: FileList | File[]) => {
      const fileList = Array.from(rawFiles);
      if (files.filter((f) => f.status !== 'deleted').length + fileList.length > maxFiles) {
        toast.error(`Maximum ${maxFiles} files allowed`);
        return;
      }

      const newUploadedFiles: UploadedFile[] = [];

      fileList.forEach((file) => {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const sizeMB = file.size / (1024 * 1024);

        if (maxSizeMB && sizeMB > maxSizeMB) {
          toast.error(`File "${file.name}" exceeds limit of ${maxSizeMB}MB`);
          return;
        }

        if (allowedTypes.length > 0 && !allowedTypes.includes(ext)) {
          toast.error(`Type .${ext} not allowed. Supported: ${allowedTypes.join(', ')}`);
          return;
        }

        const newFile: UploadedFile = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type || ext.toUpperCase(),
          url: URL.createObjectURL(file),
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'Alex Morgan',
          version: 1,
          status: 'uploading',
          progress: 10,
        };

        newUploadedFiles.push(newFile);
      });

      if (newUploadedFiles.length === 0) return;

      setFiles((prev) => {
        const updated = [...newUploadedFiles, ...prev];
        onFilesChanged?.(updated);
        return updated;
      });

      // Simulate smooth enterprise upload progress
      newUploadedFiles.forEach((file) => {
        let currentProgress = 10;
        const interval = setInterval(() => {
          currentProgress += Math.floor(Math.random() * 25) + 15;
          if (currentProgress >= 100) {
            currentProgress = 100;
            clearInterval(interval);
            setFiles((prev) =>
              prev.map((f) =>
                f.id === file.id
                  ? { ...f, progress: 100, status: 'completed' }
                  : f,
              ),
            );
            toast.success(`Uploaded "${file.name}" successfully`);
          } else {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === file.id ? { ...f, progress: currentProgress } : f,
              ),
            );
          }
        }, 150);
      });
    },
    [files, maxFiles, maxSizeMB, allowedTypes, onFilesChanged],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleDelete = (id: string) => {
    setFiles((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, status: 'deleted' as const } : f));
      onFilesChanged?.(updated);
      return updated;
    });
    toast.info('File moved to trash');
  };

  const handleRestore = (id: string) => {
    setFiles((prev) => {
      const updated = prev.map((f) => (f.id === id ? { ...f, status: 'completed' as const } : f));
      onFilesChanged?.(updated);
      return updated;
    });
    toast.success('File restored');
  };

  const handleDownload = (file: UploadedFile) => {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`Downloading ${file.name}`);
  };

  const activeFiles = files.filter((f) => f.status !== 'deleted');
  const deletedFiles = files.filter((f) => f.status === 'deleted');

  return (
    <div className="space-y-4">
      {/* Drop Target Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-emerald-500 bg-emerald-500/10 scale-[0.99]'
            : 'border-border hover:border-emerald-500/50 hover:bg-accent/40'
        } ${compact ? 'py-4' : 'py-8'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleUpload(e.target.files)}
        />
        <div className="size-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
          <UploadCloud className="size-6" />
        </div>
        <h4 className="text-sm font-semibold text-foreground">
          Drag & drop files here, or <span className="text-emerald-500 underline">browse</span>
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Supports {allowedTypes.map((t) => `.${t}`).join(', ')} up to {maxSizeMB}MB per file
        </p>
      </div>

      {/* File List */}
      {activeFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground font-medium px-1">
            <span>Files ({activeFiles.length})</span>
            <span>Total: {formatBytes(activeFiles.reduce((sum, f) => sum + f.size, 0))}</span>
          </div>

          <div className="divide-y divide-border border rounded-lg bg-card overflow-hidden">
            {activeFiles.map((file) => {
              const Icon = getFileIcon(file.name);
              return (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-3 text-sm hover:bg-accent/30 transition-colors"
                >
                  <div className="size-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Icon className="size-4 text-muted-foreground" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground truncate text-xs">{file.name}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                        v{file.version}.0
                      </Badge>
                    </div>

                    {file.status === 'uploading' ? (
                      <div className="mt-1 space-y-1">
                        <Progress value={file.progress} className="h-1.5" />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Uploading... {file.progress}%</span>
                          <span>{formatBytes(file.size)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                        <span>{formatBytes(file.size)}</span>
                        <span>•</span>
                        <span>{new Date(file.uploadedAt).toLocaleDateString()}</span>
                        <span>•</span>
                        <span className="text-emerald-500 font-medium flex items-center gap-1">
                          <ShieldCheck className="size-3" /> Encrypted
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {file.status === 'completed' && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setPreviewFile(file)}
                          title="Preview File"
                        >
                          <Eye className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => handleDownload(file)}
                          title="Download File"
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-red-600"
                      onClick={() => handleDelete(file.id)}
                      title="Move to Trash"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trash Drawer */}
      {deletedFiles.length > 0 && (
        <div className="pt-2">
          <details className="text-xs text-muted-foreground cursor-pointer">
            <summary className="font-medium hover:text-foreground">Trash ({deletedFiles.length} item)</summary>
            <div className="mt-2 divide-y divide-border border rounded-lg bg-card">
              {deletedFiles.map((file) => (
                <div key={file.id} className="flex items-center justify-between p-2 text-xs">
                  <span className="truncate">{file.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => handleRestore(file.id)}
                  >
                    <RotateCcw className="size-3" /> Restore
                  </Button>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-5 text-emerald-500" />
              {previewFile?.name}
            </DialogTitle>
            <DialogDescription>
              {previewFile && `${formatBytes(previewFile.size)} • Version ${previewFile.version}.0 • Created by ${previewFile.uploadedBy}`}
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 flex flex-col items-center justify-center bg-muted/30 rounded-lg border">
            <div className="size-16 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mb-3">
              <HardDrive className="size-8" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">{previewFile?.name}</p>
            <p className="text-xs text-muted-foreground mb-4">Enterprise Storage Vault • AES-256 Encrypted</p>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white gap-2" onClick={() => previewFile && handleDownload(previewFile)}>
              <Download className="size-4" /> Download Original File
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
