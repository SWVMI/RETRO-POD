import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  const storedState =
    request.cookies.get("youtube_oauth_state")?.value;

  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.json(
      {
        error: "Invalid OAuth response.",
      },
      { status: 400 }
    );
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  const redirectUri =
    process.env.YOUTUBE_REDIRECT_URI ||
    "http://localhost:3000/api/youtube/auth/callback";

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: "YouTube OAuth credentials are not configured.",
      },
      { status: 500 }
    );
  }

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    }
  );

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();

    console.error(
      "YouTube token exchange failed:",
      text
    );

    return NextResponse.json(
      {
        error: "Unable to complete YouTube login.",
      },
      { status: 500 }
    );
  }

  const tokens = await tokenResponse.json();

  const secret = new TextEncoder().encode(
    process.env.YOUTUBE_SESSION_SECRET
  );

  const session = await new SignJWT({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresAt:
      Date.now() +
      (tokens.expires_in || 3600) * 1000,
  })
    .setProtectedHeader({
      alg: "HS256",
    })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  const response = NextResponse.redirect(
    new URL("/", request.url)
  );

  response.cookies.set(
    "youtube_session",
    session,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    }
  );

  response.cookies.delete(
    "youtube_oauth_state"
  );

  return response;
}