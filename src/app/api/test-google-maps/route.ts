import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  console.log("[test] GOOGLE_PLACES_API_KEY set:", !!apiKey);

  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not set" });
  }

  const query = "スタートアップ 東京 採用";
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${apiKey}`;

  console.log("[test] calling Places API:", url.replace(apiKey, "REDACTED"));

  const res = await fetch(url);
  const data = await res.json();

  console.log("[test] Places API status:", data.status);
  console.log("[test] Places API results:", data.results?.length);

  return NextResponse.json({
    status: data.status,
    resultsCount: data.results?.length || 0,
    firstResult: data.results?.[0]?.name,
    error: data.error_message,
  });
}
