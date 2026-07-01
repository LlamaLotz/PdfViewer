import { NextRequest } from "next/server";

// We use Edge runtime because it has a 5-minute stream timeout
// and bypasses Vercel's 4.5MB response limit completely.
export const runtime = "edge";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface RedirectResult {
  response: Response;
  cookies: string;
}

// Recursive redirect follower that accumulates cookies across redirects
async function fetchWithRedirect(
  initialUrl: string, 
  headers: Record<string, string>, 
  accumulatedCookies = "", 
  depth = 0
): Promise<RedirectResult> {
  if (depth > 5) {
    throw new Error("Too many redirects detected");
  }

  const requestHeaders = { ...headers };
  if (accumulatedCookies) {
    requestHeaders["Cookie"] = accumulatedCookies;
  }

  const res = await fetch(initialUrl, {
    headers: requestHeaders,
    redirect: "manual", // Manually intercept redirects
  });

  const setCookies = typeof res.headers.getSetCookie === "function" 
    ? res.headers.getSetCookie() 
    : [res.headers.get("set-cookie") || ""];
    
  const newCookiesStr = setCookies.filter(Boolean).join("; ");
  
  const updatedCookies = accumulatedCookies 
    ? (newCookiesStr ? `${accumulatedCookies}; ${newCookiesStr}` : accumulatedCookies)
    : newCookiesStr;

  // Intercept 301, 302, 303, 307, 308 redirect statuses
  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const location = res.headers.get("location");
    if (location) {
      // Resolve relative redirect paths to absolute URLs if necessary
      const absoluteUrl = location.startsWith("/") 
        ? new URL(location, new URL(initialUrl).origin).toString()
        : location;

      return fetchWithRedirect(absoluteUrl, headers, updatedCookies, depth + 1);
    }
  }

  return { response: res, cookies: updatedCookies };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("id");

  if (!fileId) {
    return new Response("Missing Google Drive file ID", { status: 400 });
  }

  const checkUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  try {
    // 1. Initial request with manual recursive redirect and cookie accumulation
    const { response: firstRes, cookies: firstCookies } = await fetchWithRedirect(checkUrl, {
      "User-Agent": USER_AGENT,
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

    // Extract dynamic security parameters from Google's warning page
    const uuidMatch = htmlText.match(/name="uuid" value="([^"]+)"/) || htmlText.match(/uuid=([a-zA-Z0-9\-_]+)/);
    const uuidValue = uuidMatch ? uuidMatch[1] : "";

    const atMatch = htmlText.match(/name="at" value="([^"]+)"/);
    const atValue = atMatch ? atMatch[1] : "";

    // Target the direct download endpoint on Google content servers
    let downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    if (uuidValue) {
      downloadUrl += `&uuid=${uuidValue}`;
    }
    if (atValue) {
      downloadUrl += `&at=${atValue}`;
    }

    // 2. Fetch the final binary download link with cookies, following CDN redirects manually
    const { response: finalRes } = await fetchWithRedirect(downloadUrl, {
      "User-Agent": USER_AGENT,
    }, firstCookies);

    // 3. Stream the raw binary content back with preserved headers
    return new Response(finalRes.body, {
      status: finalRes.status,
      headers: {
        "Content-Type": finalRes.headers.get("content-type") || "application/pdf",
        "Content-Length": finalRes.headers.get("content-length") || "",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": finalRes.headers.get("content-disposition") || `inline; filename="document.pdf"`,
      },
    });
  } catch (err: any) {
    console.error("API Proxy Error:", err);
    return new Response(`Failed to stream Google Drive file: ${err.message}`, { status: 500 });
  }
}