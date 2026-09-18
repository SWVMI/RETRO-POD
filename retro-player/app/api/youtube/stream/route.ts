import { NextRequest, NextResponse } from "next/server";
import { createYouTubeAudioStream } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const videoId = request.nextUrl.searchParams.get("id")?.trim();

    if (!videoId) {
      return NextResponse.json(
        { error: "Video ID is required." },
        { status: 400 }
      );
    }

    console.log(
      `[YouTube Stream] Resolving audio-only stream for ${videoId}`
    );

    const result = await createYouTubeAudioStream(videoId);

    const range = request.headers.get("range");

    const upstreamHeaders: HeadersInit = {
      Accept: "*/*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
    };

    if (range) {
      upstreamHeaders["Range"] = range;
    }

    const upstream = await fetch(result.url, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });

    console.log(
      `[YouTube Stream] CDN response: ${upstream.status} for ${videoId}`
    );

    if (!upstream.ok && upstream.status !== 206) {
      throw new Error(
        `YouTube audio CDN returned HTTP ${upstream.status}.`
      );
    }

    const headers = new Headers();

    headers.set("Content-Type", result.mimeType);
    headers.set("Cache-Control", "no-store");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Access-Control-Allow-Origin", "*");

    for (const name of [
      "content-length",
      "content-range",
      "accept-ranges",
    ]) {
      const value = upstream.headers.get(name);

      if (value) {
        headers.set(name, value);
      }
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    console.error(
      "[YouTube Stream] Audio-only stream error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to stream YouTube audio.",
      },
      { status: 500 }
    );
  }
}