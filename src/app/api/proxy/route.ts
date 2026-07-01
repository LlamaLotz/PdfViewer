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
    // 1. Initial request (let fetch handle redirects natively to capture final cookie)
    const firstRes = await fetch(checkUrl, {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    const contentType = firstRes.headers.get("content-type") || "";

    // If it's a small file, it downloads directly without a virus warning page
    if (!contentType.includes("text/html")) {
      return new Response(firstRes.body, {
        status: firstRes.status,
        headers: {
          "Content-Type": contentType || "application/pdf",
          "Content-Length": firstRes.headers.get("content-length") || "",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const htmlText = await firstRes.text();
    
    // Safely collect Set-Cookie headers in Edge Runtime
    const setCookies = typeof firstRes.headers.getSetCookie === "function" 
      ? firstRes.headers.getSetCookie() 
      : [firstRes.headers.get("set-cookie") || ""];

    // Clean up cookies: extract ONLY the key=value pairs, ignoring Path, Domain, etc.
    const cleanCookies = setCookies
      .map(cookie => cookie.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    // Extract dynamic security parameters from the HTML warning page
    const uuidMatch = htmlText.match(/name="uuid" value="([^"]+)"/) || htmlText.match(/uuid=([a-zA-Z0-9\-_]+)/);
    const uuidValue = uuidMatch ? uuidMatch[1] : "";

    const atMatch = htmlText.match(/name="at" value="([^"]+)"/);
    const atValue = atMatch ? atMatch[1] : "";

    // Extract confirm token from the sanitized cookies, falling back to HTML
    const cookieTokenMatch = cookiesStringMatch(cleanCookies);
    const confirmToken = cookieTokenMatch 
      ? cookieTokenMatch 
      : (htmlText.match(/confirm=([0-9A-Za-z_-]+)/)?.[1] || "t");

    // Target the direct download endpoint on Google content servers
    let downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}`;
    if (uuidValue) {
      downloadUrl += `&uuid=${uuidValue}`;
    }
    if (atValue) {
      downloadUrl += `&at=${atValue}`;
    }

    // 2. Fetch the final binary stream. We let fetch handle the 303 redirect natively (redirect: "follow")
    // so it successfully follows Google's CDN redirection.
    const downloadRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cleanCookies, // Only send the sanitized download_warning cookie
      },
      redirect: "follow", // Native automatic redirection to the physical CDN storage node!
    });

    // 3. Stream the raw binary content back with preserved headers
    return new Response(downloadRes.body, {
      status: downloadRes.status,
      headers: {
        "Content-Type": downloadRes.headers.get("content-type") || "application/pdf",
        "Content-Length": downloadRes.headers.get("content-length") || "",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": downloadRes.headers.get("content-disposition") || `inline; filename="document.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("API Proxy Error:", err);
    return new Response(`Failed to stream Google Drive file: ${err.message}`, { status: 500 });
  }
}

// Utility to match the download warning cookie token cleanly
function cookiesStringMatch(cookiesString: string): string | null {
  const match = cookiesString.match(/download_warning_[^=]+=([^;,\s]+)/);
  return match ? match[1] : null;
}