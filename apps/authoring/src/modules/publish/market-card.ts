// 50 · 市集卡投影（B-28，50-step5-publish §2.2 / §6 MarketCard）。纯逻辑，不写库、不调 IO，便于单测。
//   字段来源映射（发布-03/06，缺一不可）：
//     - 名称/卖点/简介 ← 软字段（manifest.name/tagline/goal，发布前可改）。
//     - 类型标签 ← manifest.output.type 映射人话（发布-06）。
//     - 封面 ← 创作者设定（三来源 glyph/image/html_snapshot；url 由调用方解析，缺 → null 前端兜底，主页-22）。
//     - 创作者署名 ← 账号（byline，系统自动取登录账号，不可改，发布-05/26）。
//     - 可信标记 ← 系统固定「源自一次真实会话」（发布-26）。
//     - 试用 ← 系统固定 trialEnabled:false（本期不接，决策③/发布-08）。
//     - 装机量/评分 ← 上线后真实数据：本期占位 null + meta.placeholders（发布-07，非 0/非错误/非裸转圈）。
import type { Manifest, MarketCard, CoverInput, CoverSource, OutputType } from '@cb/shared';

/** usage 占位文案（响应 meta.placeholders，发布-07 / 脊柱 §2.2）。值恒 null，占位说明上线后填充。 */
export const USAGE_PLACEHOLDERS = {
  installs: '上线后由真实数据填充',
  rating: '上线后由真实数据填充',
} as const;

/** 可信标记固定文案（系统固定、不可改，发布-26）。 */
export const TRUST_BADGE = '源自一次真实会话' as const;

/** output.type → 类型标签人话（发布-06，市集卡左上「类型」）。未知兜底「能力」。 */
const TYPE_LABEL: Record<OutputType, string> = {
  text: '写作',
  structured: '结构化文档',
  score: '评估打分',
  checklist: '核查清单',
};
export function typeLabelOf(outputType: OutputType): string {
  return TYPE_LABEL[outputType] ?? '能力';
}

/** 署名格式（系统自动取登录账号，不可改，发布-05/26）：@<account>。 */
export function bylineOf(account: string): string {
  return `@${account}`;
}

/** 市集卡组装入参（manifest 软字段 + 创作者设定的封面/署名 + 解析后的封面 url）。 */
export interface BuildMarketCardArgs {
  versionId: string;
  capabilityId: string;
  slug: string;
  manifest: Manifest;
  /** 创作者账号（→ byline，自动取登录账号，发布-05/26）。 */
  account: string;
  /** 封面来源（创作者设定；缺 → 默认字形 glyph，发布-25）。 */
  cover?: CoverInput;
  /** 解析后的封面展示 url（glyph 给生成图/字形描述；缺图 → null 前端兜底占位，主页-22）。 */
  coverUrl?: string | null;
}

/**
 * 组装 MarketCard（§6 全位置，发布-03 缺一不可）。纯函数：调用方负责 coverUrl 解析。
 *   summary ← manifest.goal（能力简介软字段，发布-06）；name/tagline ← 同名软字段。
 *   installs/rating 恒 null（占位，meta.placeholders 由调用方放响应 meta，发布-07）。
 */
export function buildMarketCard(args: BuildMarketCardArgs): MarketCard {
  const m = args.manifest;
  const source: CoverSource = args.cover?.source ?? 'glyph';
  return {
    versionId: args.versionId,
    capabilityId: args.capabilityId,
    slug: args.slug,
    cover: { source, url: args.coverUrl ?? null },
    typeLabel: typeLabelOf(m.output.type),
    name: m.name,
    tagline: m.tagline,
    summary: m.goal, // 能力简介 ← goal 软字段（发布-06）。
    byline: bylineOf(args.account),
    trustBadge: TRUST_BADGE,
    trialEnabled: false, // 系统固定、本期不接（决策③）。
    installs: null, // usage 占位（meta.placeholders）。
    rating: null, // usage 占位。
  };
}
