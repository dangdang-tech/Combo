// @cb/shared — 前后端共享真源。
//
// 导出分组：
//   core/      地基：ids / 响应包络 / 错误信封 / health / trace / release
//   constants/ 路由与探针前缀
//   domains/   保留业务域 DTO + zod schema（auth / pending-recovery）
//
// 命名约定：每个 DTO 同时导出 `XxxSchema`（zod 真源）与 `Xxx`（z.infer 类型）。

export * from './core/index.js';
export * from './constants/index.js';
export * from './domains/index.js';
