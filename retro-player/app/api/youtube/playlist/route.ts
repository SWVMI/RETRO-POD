import { NextRequest, NextResponse } from "next/server";
import { getYouTubePlaylist } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id")?.trim();

    if (!id) {
      return NextResponse.json(
        { error: "Playlist ID is required." },
        { status: 400 }
      );
    }

    const playlist = await getYouTubePlaylist(id);

    return NextResponse.json(playlist);
  } catch (error) {
    console.error("YouTube playlist error:", error);

    return NextResponse.json(
      {
        error: "Unable to load YouTube playlist.",
      },
      { status: 500 }
    );
  }
}