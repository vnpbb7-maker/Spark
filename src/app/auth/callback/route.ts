import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_SITE_URL!;

  console.log("callback - code:", code ? "exists" : "missing");
  console.log(
    "callback - all cookies:",
    request.cookies.getAll().map((c) => c.name)
  );

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=no_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  console.log(
    "exchange - user:",
    data?.user?.email,
    "error:",
    error?.message
  );

  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
  }

  // セッションcookieをレスポンスに設定
  const response = NextResponse.redirect(`${origin}/dashboard`);

  // cookieStoreから全cookieをレスポンスにコピー
  cookieStore.getAll().forEach((cookie) => {
    response.cookies.set(cookie.name, cookie.value, {
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  return response;
}
