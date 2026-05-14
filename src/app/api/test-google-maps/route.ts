import { NextResponse } from "next/server";

export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  console.log("[test] GOOGLE_PLACES_API_KEY set:", !!apiKey);

  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not set" });
  }

  const query = "スタートアップ 東京 採用";
  console.log("[test] calling Places API v1 (New) with query:", query);

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber,places.id",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "ja", maxResultCount: 10 }),
  });

  console.log("[test] Places API v1 HTTP status:", res.status);
  const data = await res.json();
  console.log("[test] Places API v1 places count:", data.places?.length ?? 0);

  return NextResponse.json({
    httpStatus: res.status,
    placesCount: data.places?.length ?? 0,
    firstPlace: data.places?.[0]?.displayName?.text ?? null,
    firstWebsite: data.places?.[0]?.websiteUri ?? null,
    error: data.error?.message ?? null,
    rawError: res.ok ? undefined : data,
  });
}
