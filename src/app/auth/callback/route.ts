import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_SITE_URL!;

  console.log("callback - code:", code ? "exists" : "missing");

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=no_code`);
  }

  const cookieStore = await cookies();

  // Supabaseが設定するcookieをトラッキング
  const responseCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {}
            // レスポンス用にトラッキング
            responseCookies.push({ name, value, options: options as Record<string, unknown> });
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  console.log("exchange - user:", data?.user?.email, "error:", error?.message);
  console.log("exchange - cookies to set:", responseCookies.map((c) => c.name));

  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`);
  }

  const response = NextResponse.redirect(`${origin}/dashboard`);

  // Supabaseが設定したcookieをレスポンスにコピー
  responseCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, {
      ...options,
      path: "/",
      sameSite: "lax" as const,
      secure: true,
      httpOnly: false,
    });
  });

  return response;
}
