-- 0017 · 删除冻结预留与零使用表（Daniel 2026-07-04 决策）。
--   背景：0005/0006/0008 为未来功能预留了一批「只建表、不写数据、不挂端点」的冻结 schema。
--     经代码级排查（apps/ packages/ tools/，2026-07-04），以下 11 张表无任何运行时读写，
--     生产库中均为 0 行。未兑现的提前设计只增加理解成本，删除。
--   纪律修订：「迁移只加不减」对零使用冻结表不再适用——向后兼容的判据是「不破坏在用路径」，
--     而不是「任何表都不能删」。本迁移不触碰任何有代码读写的表。
--   注意：creator_profiles / follows / likes / dead_events / publish_batches / publish_batch_items
--     虽同为 0 行但有代码在用（功能未被触发），【不删】。
--   删除顺序：先删持有外键的子表，再删父表。

-- B-40 冻结 runtime（事件溯源消费模型，从未实现；在用的对话 runtime 是 rt_chat_*）
DROP TABLE artifacts;          -- FK → runtime_sessions
DROP TABLE usage_events;       -- FK → runtime_sessions / capabilities / users（B-36 计量，未实现）
DROP TABLE runtime_sessions;

-- B-36 计量日表（dashboard 仓储注释明确「本仓储不查」，相关指标全占位）
DROP TABLE daily_capability_stats;
DROP TABLE daily_creator_consumers;
DROP TABLE daily_creator_llm_stats;

-- B-38 经验体（零引用）
DROP TABLE experience_pack_item_sources;  -- FK → experience_pack_items
DROP TABLE experience_pack_items;         -- FK → experience_packs
DROP TABLE experience_packs;

-- B-31 评测报告（零引用，本期不参与发布门）
DROP TABLE eval_reports;

-- 主页能力共现权重（cooccur.ts 是纯内存计算，从未落库）
DROP TABLE creator_capability_cooccur;
