import { NextRequest, NextResponse } from "next/server";
import { Innertube, UniversalCache } from "youtubei.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("id")?.trim();

  if (!videoId) {
    return NextResponse.json(
      { error: "Video ID is required." },
      { status: 400 }
    );
  }

  try {
    console.log(`[DEBUG ANDROID] Testing ANDROID_VR for ${videoId}`);

    const yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
    });

    const streamingData = await yt.getStreamingData(videoId, {
      client: "ANDROID_VR",
      type: "audio",
      quality: "best",
    } as any);

    return NextResponse.json({
      success: true,
      videoId,
      client: "ANDROID_VR",
      itag: streamingData.itag,
      mimeType: streamingData.mime_type,
      hasUrl: !!streamingData.url,
      duration: streamingData.approx_duration_ms,
    });
  } catch (error) {
    console.error("[DEBUG ANDROID] Failed:", error);

    return NextResponse.json(
      {
        success: false,
        videoId,
        client: "ANDROID_VR",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}