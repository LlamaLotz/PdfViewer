"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Loader2, 
  Link2, 
  AlertTriangle, 
  FileText,
  HelpCircle,
  FolderOpen,
  Upload
} from "lucide-react";

// Auto-resolves links into direct streaming assets
const resolveStreamUrl = (inputUrl: string): string => {
  // 1. Convert Dropbox links
  if (inputUrl.includes("dropbox.com")) {
    return inputUrl
      .replace("www.dropbox.com", "dl.dropboxusercontent.com")
      .replace("dl=0", "dl=1")
      .replace("dl=default", "dl=1");
  }

  // 2. Convert Pixeldrain links
  if (inputUrl.includes("pixeldrain.com")) {
    const pixelMatch = inputUrl.match(/\/u\/([a-zA-Z0-9_-]+)/);
    if (pixelMatch && pixelMatch[1]) {
      const fileId = pixelMatch[1];
      return `https://pixeldrain.com/api/file/${fileId}`;
    }
  }

  // 3. Convert Google Drive links to our internal Edge streaming proxy
  const driveRegex = /\/file\/d\/([a-zA-Z0-9_-]+)\/(view|edit|preview)/;
  const driveOpenRegex = /open\?id=([a-zA-Z0-9_-]+)/;
  
  let fileId = "";
  const match1 = inputUrl.match(driveRegex);
  const match2 = inputUrl.match(driveOpenRegex);
  
  if (match1 && match1[1]) {
    fileId = match1[1];
  } else if (match2 && match2[1]) {
    fileId = match2[1];
  }
  
  if (fileId) {
    return `/api/proxy?id=${fileId}`;
  }
  
  return inputUrl;
};

export default function PdfViewer() {
  const [url, setUrl] = useState<string>(
    "https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/web/compressed.tracemonkey-pldi-09.pdf"
  );
  const [inputUrl, setInputUrl] = useState<string>("");
  const [pdfjs, setPdfjs] = useState<any>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [rendering, setRendering] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  // 1. Dynamically load the PDFJS library only on the client-side
  useEffect(() => {
    const initPdfjs = async () => {
      try {
        const library = await import("pdfjs-dist");
        const isModern = !library.version.startsWith("3");
        const ext = isModern ? "mjs" : "js";
        library.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${library.version}/build/pdf.worker.min.${ext}`;
        setPdfjs(library);
      } catch (err: any) {
        console.error("Error loading PDF engine:", err);
        setError("Failed to initialize PDF rendering engine.");
      }
    };
    initPdfjs();
  }, []);

  // 2. Load PDF on-demand with Range & Streaming properties enabled
  useEffect(() => {
    if (!url || !pdfjs) return;

    let active = true;
    const loadPdf = async () => {
      setLoading(true);
      setError(null);
      setCurrentPage(1);

      try {
        const targetUrl = resolveStreamUrl(url);

        const loadingTask = pdfjs.getDocument({
          url: targetUrl,
          disableRange: false,     // Enables HTTP range requests
          disableStream: false,    // Enables streaming
          disableAutoFetch: true,  // Prevents prefetching of idle pages (crucial for massive PDFs)
        });

        const pdfDoc = await loadingTask.promise;
        if (active) {
          setPdf(pdfDoc);
          setNumPages(pdfDoc.numPages);
          setLoading(false);
        }
      } catch (err: any) {
        console.error("PDF Loading error: ", err);
        if (active) {
          setError(
            err.message?.includes("CORS") || err.name === "NetworkError"
              ? "Access Blocked: Ensure your file sharing settings in Google Drive or Dropbox are set to 'Anyone with the link can view'."
              : `Failed to open PDF document: ${err.message || "Unknown error occurred"}`
          );
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      active = false;
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    };
  }, [url, pdfjs]);

  // 3. Canvas rendering procedure
  const renderPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return;

    try {
      setRendering(true);
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: zoom, rotation: rotation });

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      const devicePixelRatio = window.devicePixelRatio || 1;
      canvas.height = viewport.height * devicePixelRatio;
      canvas.width = viewport.width * devicePixelRatio;
      canvas.style.height = `${viewport.height}px`;
      canvas.style.width = `${viewport.width}px`;

      context.scale(devicePixelRatio, devicePixelRatio);

      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
      setRendering(false);
    } catch (err: any) {
      if (err.name !== "RenderingCancelledException") {
        console.error("Rendering error: ", err);
        setRendering(false);
      }
    }
  }, [pdf, currentPage, zoom, rotation]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  // 4. Keyboard navigation event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCurrentPage((prev) => Math.max(prev - 1, 1));
      } else if (e.key === "ArrowRight") {
        setCurrentPage((prev) => Math.min(prev + 1, numPages));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [numPages]);

  // 5. Handle Local File Uploads (Zero-Server-Streaming)
  const handleLocalFileLoad = (file: File) => {
    if (file && file.type === "application/pdf") {
      setError(null);
      const localBlobUrl = URL.createObjectURL(file);
      setUrl(localBlobUrl);
    } else {
      alert("Please select a valid PDF file.");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLocalFileLoad(file);
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleLocalFileLoad(file);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputUrl.trim()) {
      setUrl(inputUrl.trim());
    }
  };

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="flex flex-col border-b border-slate-800 bg-slate-900 px-6 py-4 md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-indigo-400" />
          <h1 className="text-lg font-bold tracking-tight">PDF Stream Viewer</h1>
        </div>

        {/* URL Input Form */}
        <form onSubmit={handleUrlSubmit} className="flex flex-1 max-w-xl gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="url"
              placeholder="Paste direct PDF, Dropbox, or Pixeldrain link..."
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              className="w-full rounded-lg bg-slate-950 py-2 pl-9 pr-4 text-sm text-slate-300 placeholder-slate-500 outline-none ring-1 ring-slate-800 transition focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500 transition duration-150"
          >
            Stream File
          </button>
        </form>

        {/* Local File Selector Button */}
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            id="local-file-picker"
            className="hidden"
          />
          <label
            htmlFor="local-file-picker"
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700 cursor-pointer transition border border-slate-700"
          >
            <FolderOpen className="h-4 w-4 text-indigo-400" />
            <span>Open Local File (Up to 10GB)</span>
          </label>

          <button
            onClick={() => setShowInstructions(!showInstructions)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-indigo-400 transition"
          >
            <HelpCircle className="h-4 w-4" />
            Streaming Help
          </button>
        </div>
      </header>

      {/* Main Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Jump to page */}
        <div className="hidden w-64 flex-col border-r border-slate-800 bg-slate-900/50 md:flex">
          <div className="p-4 border-b border-slate-800">
            <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">Documents Pages</h2>
            <p className="text-xxs text-slate-500 mt-1">Chunked on-demand render</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {numPages > 0 ? (
              Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition ${
                    currentPage === pageNum
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-slate-400 hover:bg-slate-800/80 hover:text-slate-200"
                  }`}
                >
                  Page {pageNum}
                </button>
              ))
            ) : (
              <div className="p-4 text-xs text-slate-500 text-center">No document loaded</div>
            )}
          </div>
        </div>

        {/* Canvas Display Viewport */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-slate-950">
          {/* Controls Bar */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/30 px-6 py-2">
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1 || loading}
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="text-xs text-slate-300 font-medium select-none">
                Page {currentPage} of {numPages || "?"}
              </span>
              <button
                disabled={currentPage >= numPages || loading}
                onClick={() => setCurrentPage((p) => Math.min(p + 1, numPages))}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 border-r border-slate-800 pr-3">
                <button
                  onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <span className="text-xs text-slate-300 min-w-[3rem] text-center font-mono">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(z + 0.25, 3.0))}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>

              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                title="Rotate 90°"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Active Work Area + Drag and Drop Wrapper */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex-1 overflow-auto p-8 flex justify-center items-start transition-all ${
              isDragOver ? "bg-indigo-950/25 border-4 border-dashed border-indigo-500/50" : ""
            }`}
          >
            {isDragOver ? (
              <div className="flex flex-col items-center gap-4 pointer-events-none animate-pulse self-center my-auto">
                <Upload className="h-16 w-16 text-indigo-400" />
                <p className="text-lg font-bold text-indigo-300">Drop your PDF file here</p>
                <p className="text-xs text-slate-400">Instantly stream files up to 10GB</p>
              </div>
            ) : error ? (
              <div className="max-w-md rounded-xl border border-rose-500/30 bg-rose-950/20 p-6 text-center shadow-lg self-center my-auto">
                <AlertTriangle className="mx-auto h-12 w-12 text-rose-500" />
                <h3 className="mt-4 font-semibold text-rose-200">Failed to stream document</h3>
                <p className="mt-2 text-xs text-rose-300/80 leading-relaxed">{error}</p>
              </div>
            ) : (
              /* Standard High-Performance Canvas View */
              <div className="relative border border-slate-800 rounded bg-slate-900 shadow-2xl min-h-[400px]">
                {/* Active Loading Overlay */}
                {(loading || rendering || !pdfjs) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-sm z-10 transition">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                    <p className="mt-3 text-xs text-slate-300 font-medium">
                      {!pdfjs ? "Loading PDF core..." : loading ? "Streaming range-chunks..." : "Rendering view pixels..."}
                    </p>
                  </div>
                )}
                <canvas ref={canvasRef} className="block" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Help Dialog Box */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-md font-semibold text-slate-100">Configuring Massive File Streaming</h3>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              For files exceeding **100MB** up to **2GB**, this app avoids downloading full packages by making partial requests. However, the host cloud storage has structural requirements:
            </p>
            <ul className="mt-4 list-disc pl-5 text-xs text-slate-400 space-y-2">
              <li>
                <strong>HTTP Range Requests:</strong> The host server must support the <code className="font-mono text-indigo-300 bg-slate-950 px-1 py-0.5 rounded">Accept-Ranges</code> header. Cloud services like AWS S3, Google Cloud Storage, Cloudflare R2, and GitHub Pages support this automatically.
              </li>
              <li>
                <strong>CORS Configuration:</strong> Cloud storage blocks external direct browser connections by default. Ensure CORS is enabled on your host bucket, allowing origins to access resources.
              </li>
              <li>
                <strong>Google Drive / Dropbox:</strong> Use direct download stream links instead of sharing page links.
              </li>
            </ul>
            <button
              onClick={() => setShowInstructions(false)}
              className="mt-6 w-full rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition"
            >
              Close Instructions
            </button>
          </div>
        </div>
      )}
    </div>
  );
}