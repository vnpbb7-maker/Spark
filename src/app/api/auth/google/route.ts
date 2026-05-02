import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();

  // Supabaseが設定するcookieをトラッキング
  const responseCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {}
            responseCookies.push({ name, value, options: options as Record<string, unknown> });
          });
        },
      },
    }
  );

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
      scopes: "email profile",
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL}/auth/login?error=oauth_failed`
    );
  }

  const response = NextResponse.redirect(data.url);

  // PKCE code_verifier等のcookieをレスポンスに設定
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
