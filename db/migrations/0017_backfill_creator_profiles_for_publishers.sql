-- 0017 · 真实发布后补齐公开创作者主页基行。
-- 发布门后续会同事务 ensure creator_profiles；本迁移只回填已经发布过能力但缺名片的历史用户。

INSERT INTO creator_profiles (user_id, slug, display_name, identity_tags, bio)
SELECT
  u.id,
  COALESCE(
    NULLIF(btrim(regexp_replace(lower(u.account), '[^a-z0-9]+', '-', 'g'), '-'), ''),
    'creator-' || left(replace(u.id::text, '-', ''), 12)
  ) AS slug,
  u.account AS display_name,
  ARRAY['创作者']::text[] AS identity_tags,
  '' AS bio
FROM users u
WHERE EXISTS (
  SELECT 1
    FROM capabilities c
    JOIN publications p ON p.capability_id = c.id
   WHERE c.creator_user_id = u.id
     AND p.review_status IN ('alpha_pending', 'published')
)
ON CONFLICT DO NOTHING;
