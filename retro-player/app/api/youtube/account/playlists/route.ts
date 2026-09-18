import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

async function getSession(request: NextRequest) {
  const token =
    request.cookies.get("youtube_session")?.value;

  if (!token) {
    return null;
  }

  try {
    const secret = new TextEncoder().encode(
      process.env.YOUTUBE_SESSION_SECRET
    );

    const { payload } = await jwtVerify(
      token,
      secret
    );

    return payload as {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest
) {
  const session = await getSession(request);

  if (!session?.accessToken) {
    return NextResponse.json(
      {
        error: "Not signed in.",
      },
      { status: 401 }
    );
  }

  const url =
    "https://www.googleapis.com/youtube/v3/playlists?" +
    new URLSearchParams({
      part: "snippet,contentDetails",
      mine: "true",
      maxResults: "50",
    }).toString();

  const response = await fetch(url, {
    headers: {
      Authorization:
        `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();

    console.error(
      "YouTube playlists request failed:",
      text
    );

    return NextResponse.json(
      {
        error: "Unable to load YouTube playlists.",
      },
      { status: response.status }
    );
  }

  const data = await response.json();

  return NextResponse.json({
    playlists: data.items || [],
  });
}