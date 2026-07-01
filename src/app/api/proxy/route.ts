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
    // 1. Initial request with a real browser User-Agent & manual redirect handling
    let res = await fetch(checkUrl, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      redirect: "manual",
    });

    // Safely collect all Set-Cookie headers in Edge Runtime
    let cookiesArray = typeof res.headers.getSetCookie === "function" 
      ? res.headers.getSetCookie() 
      : [res.headers.get("set-cookie") || ""];

    // Manually follow Google Drive redirects and accumulate cookies
    if (res.status === 302 || res.status === 301 || res.status === 307) {
      const location = res.headers.get("location");
      if (location) {
        res = await fetch(location, {
          headers: {
            "User-Agent": USER_AGENT,
            "Cookie": cookiesArray.filter(Boolean).join("; "),
          },
          redirect: "manual",
        });
        const newCookies = typeof res.headers.getSetCookie === "function" 
          ? res.headers.getSetCookie() 
          : [res.headers.get("set-cookie") || ""];
        cookiesArray = [...cookiesArray, ...newCookies];
      }
    }

    const contentType = res.headers.get("content-type") || "";

    // If it's a small file, it downloads directly without a virus warning page
    if (!contentType.includes("text/html")) {
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": contentType || "application/pdf",
          "Content-Length": res.headers.get("content-length") || "",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const htmlText = await res.text();
    const cookiesString = cookiesArray.filter(Boolean).join("; ");

    // Extract both the "uuid" and "at" security parameters from Google's HTML form
    const uuidMatch = htmlText.match(/name="uuid" value="([^"]+)"/) || htmlText.match(/uuid=([a-zA-Z0-9\-_]+)/);
    const uuidValue = uuidMatch ? uuidMatch[1] : "";

    const atMatch = htmlText.match(/name="at" value="([^"]+)"/);
    const atValue = atMatch ? atMatch[1] : "";

    // Target Google's raw content download endpoint directly to prevent cookies from being stripped
    let downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    if (uuidValue) {
      downloadUrl += `&uuid=${uuidValue}`;
    }
    if (atValue) {
      downloadUrl += `&at=${atValue}`;
    }

    // 2. Authenticated direct request using accumulated cookies and Chrome headers
    const downloadRes = await fetch(downloadUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Cookie": cookiesString,
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