import { NextRequest, NextResponse } from "next/server";
import { searchYouTube } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim();

    if (!query) {
      return NextResponse.json(
        { error: "Search query is required." },
        { status: 400 }
      );
    }

    const results = await searchYouTube(query);

    return NextResponse.json({
      results,
    });
  } catch (error) {
    console.error("YouTube search error:", error);

    return NextResponse.json(
      {
        error: "YouTube search failed.",
      },
      { status: 500 }
    );
  }
}