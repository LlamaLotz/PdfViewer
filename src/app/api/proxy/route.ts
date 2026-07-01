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
    const setCookieHeader = firstRes.headers.get("set-cookie") || "";

    // Extract ONLY the critical download_warning cookie (e.g. "download_warning_123=ABCD")
    const warningCookieMatch = setCookieHeader.match(/(download_warning_[^=]+=[^;,\s]+)/);
    const warningCookie = warningCookieMatch ? warningCookieMatch[1] : "";

    // Extract the confirm token (use cookie value first, then HTML, then fall back to 't')
    const confirmToken = warningCookieMatch 
      ? warningCookieMatch[1].split("=")[1] 
      : (htmlText.match(/confirm=([0-9A-Za-z_-]+)/)?.[1] || "t");

    // Extract uuid and at tokens from the HTML
    const uuidValue = htmlText.match(/name="uuid" value="([^"]+)"/)?.[1] || "";
    const atValue = htmlText.match(/name="at" value="([^"]+)"/)?.[1] || "";

    // Construct the direct download link
    let downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmToken}`;
    if (uuidValue) {
      downloadUrl += `&uuid=${uuidValue}`;
    }
    if (atValue) {
      downloadUrl += `&at=${atValue}`;
    }

    // 2. Fetch the final binary download link with cookies, letting fetch handle redirects natively
    const downloadRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": warningCookie, // Only send the sanitized download_warning cookie
      },
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