
import { NextRequest, NextResponse } from "next/server";
import { Innertube, UniversalCache } from "youtubei.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("id")?.trim();

  if (!videoId) {
    return NextResponse.json({ error: "Video ID is required." }, { status: 400 });
  }

  try {
    console.log(`[DEBUG] Creating Innertube for ${videoId}`);

    const yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      retrieve_player: true,
    });

    console.log(`[DEBUG] Innertube created`);

    const info = await yt.getBasicInfo(videoId);

    console.log(`[DEBUG] Basic info retrieved`);

    return NextResponse.json({
      success: true,
      videoId,
      playability: info.playability_status,
      streamingDataAvailable: !!info.streaming_data,
      formatCount: info.streaming_data?.formats?.length ?? 0,
      adaptiveFormatCount:
        info.streaming_data?.adaptive_formats?.length ?? 0,
      formats: info.streaming_data?.formats?.map((f: any) => ({
        itag: f.itag,
        mimeType: f.mime_type,
        quality: f.quality,
      })) ?? [],
    });
  } catch (error) {
    console.error("[DEBUG] Failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}