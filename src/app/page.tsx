"use client";

import dynamic from "next/dynamic";

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-200">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      <p className="mt-4 text-sm font-medium">Initializing Streaming Engine...</p>
    </div>
  ),
});

export default function Home() {
  return <PdfViewer />;
}