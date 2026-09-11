# constants — 路由常量

这个目录集中定义对外 HTTP 路径相关的常量，让后端挂路由和前端拼请求地址用同一份字符串。

## 文件

- `routes.ts` 定义 API 路由前缀 `API_PREFIX`（值为 `/api/v1`）以及不带前缀的健康探针路径 `HEALTH_PATH` 与 `READY_PATH`。
- `index.ts` 只做转出，把 `routes.ts` 的导出暴露给包入口。

## 上下游

authoring 在 `bootstrap/routes.ts` 引用 `API_PREFIX` 作为业务路由前缀，在 `platform/http/health.ts` 引用 `HEALTH_PATH` 和 `READY_PATH` 注册探针端点；`bootstrap/app.ts` 还用 `API_PREFIX` 做请求日志的路径判断。
