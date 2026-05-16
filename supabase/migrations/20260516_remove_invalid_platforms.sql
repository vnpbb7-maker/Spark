-- producthunt_competitor と google_maps_review を削除
-- 理由: Tavily経由では投稿者個人を特定できず、ページ/記事タイトルがusernameになっていた
DELETE FROM targets
WHERE platform IN (
  'producthunt_competitor',
  'google_maps_review',
  'Producthunt_competitor',
  'Google_maps_review'
);
