import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function POST(req: NextRequest) {
  const { platform } = await req.json();

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // platform_credentialsから認証情報を取得
  const { data: creds } = await supabase
    .from("platform_credentials")
    .select("credentials")
    .eq("user_id", user.id)
    .eq("platform", platform)
    .single();

  if (!creds) {
    return NextResponse.json({
      success: false,
      error: "このプラットフォームの認証情報が登録されていません",
    });
  }

  // 認証情報が存在することだけ確認
  // 実際のログインテストはPlaywright実装後に追加
  const credentials = creds.credentials as Record<string, string>;
  const hasCredentials = credentials.username || credentials.email;

  if (!hasCredentials) {
    return NextResponse.json({
      success: false,
      error: "ユーザー名またはメールアドレスが登録されていません",
    });
  }

  return NextResponse.json({
    success: true,
    message: `${platform}の認証情報が登録されています`,
  });
}
