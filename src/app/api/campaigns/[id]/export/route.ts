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

    // Fetch top 100 targets with comments
    const { data: targets } = await supabase
      .from("targets")
      .select("*, comments(*)")
      .eq("campaign_id", campaignId)
      .order("match_score", { ascending: false })
      .limit(100);

    // Build rows
    const rows = (targets || []).map(
      (t: Record<string, unknown>, i: number) => {
        const comments = (t.comments as Array<Record<string, unknown>>) || [];
        const comment = comments[0];
        return {
          "#": i + 1,
          ユーザー名: t.username as string,
          プラットフォーム: t.platform as string,
          マッチ度: `${t.match_score}%`,
          投稿URL: t.post_url as string,
          投稿内容: ((t.post_content as string) || "").slice(0, 300),
          マッチ理由: (t.match_reason as string) || "",
          メール: (t.email as string) || "",
          電話番号: (t.phone as string) || "",
          ウェブサイト: (t.website as string) || "",
          問い合わせURL: (t.contact_url as string) || "",
          生成コメント: comment
            ? ((comment.content as string) || "").slice(0, 300)
            : "",
          アプローチ: comment ? (comment.approach as string) || "" : "",
          承認状態: comment
            ? (comment.approved as boolean)
              ? "✅ 承認済み"
              : "⏳ 未承認"
            : "— コメントなし",
          投稿状態: comment
            ? (comment.posted_at as string)
              ? "📤 投稿済み"
              : "未投稿"
            : "—",
          発見日時: t.created_at
            ? new Date(t.created_at as string).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })
            : "",
        };
      }
    );

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    ws["!cols"] = [
      { wch: 4 }, // #
      { wch: 20 }, // ユーザー名
      { wch: 12 }, // プラットフォーム
      { wch: 8 }, // マッチ度
      { wch: 40 }, // 投稿URL
      { wch: 50 }, // 投稿内容
      { wch: 30 }, // マッチ理由
      { wch: 25 }, // メール
      { wch: 16 }, // 電話番号
      { wch: 30 }, // ウェブサイト
      { wch: 30 }, // 問い合わせURL
      { wch: 50 }, // 生成コメント
      { wch: 30 }, // アプローチ
      { wch: 12 }, // 承認状態
      { wch: 12 }, // 投稿状態
      { wch: 18 }, // 発見日時
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
