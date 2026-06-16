// 公开能力页 /a/:slug（对外只读最小视图）——工作台「查看公开页」/ 作品墙卡片的落点。
//
// 本期范围（开工总纲）：只读最小卡，不进编辑/管理、不显经营维度（收益/消耗）。
//   消费侧「市集详情完整页」不在本期 → 此处给只读最小卡（能力对外信息），不裸 404、不裸转圈。
//   无对应公开 by-slug 后端端点（本期不造）：故无数据拉取、无 loading 态（无 fetch 即无裸转圈问题）；
//   slug 缺失（异常路由）→ ErrorState（人话 + 退路，绝不裸码），不落 NotFound。
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { ErrorState } from '../../components/index.js';

export function PublicCapabilityPage(): ReactElement {
  const { slug } = useParams<{ slug: string }>();

  // 正常路由 /a/:slug 必带 slug；缺失视为异常 → 人话错误态（绝不裸码），不裸 404。
  if (slug === undefined || slug.length === 0) {
    return (
      <div className="cb-page cb-public-capability">
        <ErrorState error={{ userMessage: '能力链接无效或已失效。', action: 'none' }} />
      </div>
    );
  }

  return (
    <section
      className="cb-page cb-public-capability"
      aria-labelledby="cb-public-capability-title"
      data-slug={slug}
    >
      <article className="cb-public-card" aria-label="公开能力卡">
        <p className="cb-public-card__badge">源自一次真实会话</p>
        <h2 className="cb-public-card__title" id="cb-public-capability-title">
          {slug}
        </h2>
        <p className="cb-public-card__lead">
          这是该能力的公开只读页。市集完整详情（试用 / 安装 /
          评分）将随消费侧上线开放，本期仅展示对外信息。
        </p>
      </article>
    </section>
  );
}
