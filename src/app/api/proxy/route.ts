import { NextRequest } from "next/server";

// We use Edge runtime because it has a 5-minute stream timeout
// and bypasses Vercel's 4.5MB response limit completely.
export const runtime = "edge";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");

  if (!fileId) {
    return new Response("Missing Google Drive file ID", { status: 400 });
  }

  const checkUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    // 1. Initial request with a real browser User-Agent to avoid bot blocking
    const res = await fetch(checkUrl, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    const contentType = res.headers.get("content-type") || "";

    // If it's a small file, it downloads directly without a virus warning page
    if (!contentType.includes("text/html")) {
      return new Response(res.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const htmlText = await res.text();
    const cookies = res.headers.get("set-cookie") || "";

    // Multi-layer confirm token extraction:
    // Option A: Extract from the download_warning cookie directly
    const cookieMatch = cookies.match(/download_warning_[^=]+=([^;]+)/);
    
    // Option B: Extract from the HTML text (form action or inputs)
    const confirmMatch = 
      htmlText.match(/confirm=([0-9A-Za-z_-]+)/) || 
      htmlText.match(/name="confirm" value="([^"]+)"/);

    // Get the confirm token (use cookie first, then HTML, then fall back to 't')
    const confirmToken = (cookieMatch && cookieMatch[1]) || (confirmMatch && confirmMatch[1]) || "t";

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmToken}`;

    // 2. Authenticated second request using cookies and browser User-Agent
    const downloadRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": USER_AGENT,
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