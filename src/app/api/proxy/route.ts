import { NextRequest } from "next/server";

// CRUCIAL: We use Edge runtime because it has a 5-minute stream timeout
// and bypasses the 4.5MB response size limit completely.
export const runtime = "edge";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");

  if (!fileId) {
    return new Response("Missing Google Drive file ID", { status: 400 });
  }

  const checkUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    // 1. Initial request to Google Drive to check if it's a small or large file
    const res = await fetch(checkUrl);
    const contentType = res.headers.get("content-type") || "";

    // If it's a small file (under 25MB), Google streams the raw PDF immediately
    if (!contentType.includes("text/html")) {
      return new Response(res.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // If it's a large file (over 25MB), Google serves an HTML warning page.
    // We scrape the confirm token and collect the session cookies.
    const htmlText = await res.text();
    const confirmMatch = htmlText.match(/confirm=([0-9A-Za-z_-]+)/);
    
    if (!confirmMatch) {
      return new Response(
        "Could not bypass Google virus scan. Ensure your Google Drive file is set to 'Anyone with the link can view'.",
        { status: 500 }
      );
    }

    const cookies = res.headers.get("set-cookie") || "";
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch[1]}`;

    // 2. Make the authenticated second request using Google's session cookies
    const downloadRes = await fetch(downloadUrl, {
      headers: {
        Cookie: cookies,
      },
    });

    // 3. Stream the raw binary stream back to the browser progressively
    return new Response(downloadRes.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": `inline; filename="document.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("API Proxy Error:", err);
    return new Response(`Failed to stream Google Drive file: ${err.message}`, { status: 500 });
  }
}