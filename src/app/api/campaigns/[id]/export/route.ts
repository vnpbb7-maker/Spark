import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: campaignId } = await params;
    const supabase = await createClient();

    // Auth check
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    // Verify campaign belongs to user
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, product_description, user_id")
      .eq("id", campaignId)
      .single();

    if (!campaign || campaign.user_id !== user.id) {
      return NextResponse.json(
        { error: "キャンペーンが見つかりません" },
        { status: 404 }
      );
    }

    // Fetch targets — if specific IDs provided, only those; otherwise top 100
    const idsParam = req.nextUrl.searchParams.get("ids");
    const targetIds = idsParam ? idsParam.split(",").filter(Boolean) : null;

    let query = supabase
      .from("targets")
      .select("*, comments(*)")
      .eq("campaign_id", campaignId)
      .order("match_score", { ascending: false });

    if (targetIds && targetIds.length > 0) {
      query = query.in("id", targetIds);
    } else {
      query = query.limit(100);
    }

    const { data: targets } = await query;

    // Build rows
    const rows = (targets || []).map(
      (t: Record<string, unknown>, i: number) => {
        const comments = (t.comments as Array<Record<string, unknown>>) || [];
        const comment = comments[0];
        const rawEmail = (t.email as string) || "";
        const twitterHandle = (t.twitter_handle as string) || "";
        // Fix: if email starts with "Twitter:", it's actually a twitter handle
        const isEmailActuallyTwitter = rawEmail.startsWith("Twitter:");
        const realEmail = isEmailActuallyTwitter ? "" : rawEmail;
        const realTwitter = twitterHandle || (isEmailActuallyTwitter ? rawEmail.replace("Twitter: ", "").replace("Twitter:", "") : "");
        return {
          "#": i + 1,
          優先度: (t.priority as string) || "—",
          マッチ度: `${t.match_score}%`,
          プラットフォーム: t.platform as string,
          ユーザー名: t.username as string,
          "Twitter連絡先": realTwitter,
          メール: realEmail,
          プロフィールURL: (t.contact_url as string) || (t.profile_url as string) || "",
          投稿URL: (t.post_url as string) || "",
          投稿内容: ((t.post_content as string) || "").slice(0, 300),
          AI分析理由: (t.ai_reason as string) || "",
          "Q1_課題スコア": (t.q1_score as number) ?? (t.relevance_score as number) ?? "",
          "Q2_意欲スコア": (t.q2_score as number) ?? (t.intent_score as number) ?? "",
          "Q3_接触スコア": (t.q3_score as number) ?? (t.influence_score as number) ?? "",
          "総合スコア": (t.match_score as number) ?? "",
          推定年齢: (t.estimated_age as string) || "",
          推定役職: (t.estimated_role as string) || "",
          生成コメント: comment
            ? ((comment.content as string) || "").slice(0, 300)
            : "",
          アプローチ: comment ? (comment.approach as string) || "" : "",
          発見日時: t.created_at
            ? new Date(t.created_at as string).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })
            : "",
          電話番号: (t.phone as string) || "",
          ウェブサイト: (t.website as string) || "",
        };
      }
    );

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws["!cols"] = [
      { wch: 4 }, // #
      { wch: 6 }, // 優先度
      { wch: 8 }, // マッチ度
      { wch: 12 }, // プラットフォーム
      { wch: 20 }, // ユーザー名
      { wch: 40 }, // 投稿URL
      { wch: 50 }, // 投稿内容
      { wch: 40 }, // AI分析理由
      { wch: 10 }, // 課題一致度
      { wch: 10 }, // 行動意欲
      { wch: 8 }, // 影響力
      { wch: 10 }, // 接触可能性
      { wch: 10 }, // 推定年齢
      { wch: 16 }, // 推定役職
      { wch: 50 }, // 生成コメント
      { wch: 30 }, // アプローチ
      { wch: 18 }, // 発見日時
      { wch: 25 }, // メール
      { wch: 16 }, // 電話番号
      { wch: 30 }, // ウェブサイト
      { wch: 30 }, // 問い合わせURL
    ];

    XLSX.utils.book_append_sheet(wb, ws, "ターゲット一覧");

    // Generate buffer
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = `spark_targets_${campaignId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "エクスポートに失敗しました" },
      { status: 500 }
    );
  }
}
