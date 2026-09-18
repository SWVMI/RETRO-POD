import { NextRequest, NextResponse } from "next/server";
import {
  createYouTubeSabrStream,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest
) {
  try {
    const videoId =
      request.nextUrl.searchParams
        .get("id")
        ?.trim();

    if (!videoId) {
      return NextResponse.json(
        {
          error:
            "Video ID is required.",
        },
        {
          status: 400,
        }
      );
    }

    console.log(
      `[YouTube Stream] Starting SABR stream for ${videoId}`
    );

    const result =
      await createYouTubeSabrStream(
        videoId
      );

    if (!result.stream) {
      throw new Error(
        "SABR returned no audio stream."
      );
    }

    const headers = new Headers();

    headers.set(
      "Content-Type",
      result.mimeType
    );

    headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate"
    );

    headers.set(
      "Accept-Ranges",
      "none"
    );

    headers.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    return new NextResponse(
      result.stream,
      {
        status: 200,
        headers,
      }
    );
  } catch (error) {
    console.error(
      "[YouTube Stream] SABR error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Unable to stream YouTube audio.",
      },
      {
        status: 500,
      }
    );
  }
}