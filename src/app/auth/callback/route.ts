import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin;

  console.log("callback called, code:", code ? "exists" : "missing");
  console.log("origin:", origin);

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
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
    console.log("exchange result - data:", data?.user?.email, "session:", !!data?.session, "error:", error);

    if (!error && data.session) {
      return NextResponse.redirect(`${origin}/dashboard`);
    }

    console.log("auth error details:", JSON.stringify(error));
    return NextResponse.redirect(
      `${origin}/auth/login?error=auth_failed&details=${error.message}`
    );
  }

  console.log("no code found in callback");
  return NextResponse.redirect(`${origin}/auth/login?error=no_code`);
}
