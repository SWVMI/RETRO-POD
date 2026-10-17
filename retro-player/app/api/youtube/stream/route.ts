
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const streamServerUrl = process.env.YOUTUBE_STREAM_SERVER_URL;
  const videoId = request.nextUrl.searchParams.get("id");

  if (!streamServerUrl) {
    return NextResponse.json(
      { error: "YOUTUBE_STREAM_SERVER_URL is not configured" },
      { status: 500 }
    );
  }

  if (!videoId) {
    return NextResponse.json(
      { error: "Missing video ID" },
      { status: 400 }
    );
  }

  try {
    const backendUrl = new URL(
      "/stream",
      streamServerUrl.endsWith("/")
        ? streamServerUrl
        : `${streamServerUrl}/`
    );

    backendUrl.searchParams.set("id", videoId);

    const range = request.headers.get("range");
    const upstream = await fetch(backendUrl.toString(), {
      method: "GET",
      headers: range ? { Range: range } : undefined,
      cache: "no-store",
    });

    if (!upstream.ok) {
      const details = await upstream.text().catch(() => "");
      console.error(
        "Render stream error:",
        upstream.status,
        details.slice(0, 500)
      );

      return NextResponse.json(
        { error: "Streaming server request failed", status: upstream.status },
        { status: 502 }
      );
    }

    const headers = new Headers();

    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    headers.set("Cache-Control", "no-store");

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error("YouTube stream proxy error:", error);

    return NextResponse.json(
      { error: "Unable to reach streaming server" },
      { status: 502 }
    );
  }
}
