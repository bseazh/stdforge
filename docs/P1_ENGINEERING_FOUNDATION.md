# P1-PE 工程化基础重构

## 1. 范围

本文将本轮“P1PE”按 **P1-PE（P1 Engineering Foundation，P1 工程化基础）** 执行：在不迁移页面、不变更既有 API 路径、不改变线上业务流程的前提下，先建立可复用的配置、契约和外部集成边界。

P1-PE 不是全量重写，也不包含数据库、队列或 React 前端合并。这些工作继续按 [P0 架构基线](P0_ARCHITECTURE_BASELINE.md) 的 P1 起步顺序推进。

## 2. 本轮完成内容

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 集中运行时配置 | `packages/config/runtime-config.mjs` | 统一读取本地忽略配置与部署环境变量，集中处理端口、SMTP、LLM、MinerU、飞书配置和无密钥健康摘要。 |
| 统一 API 信封 | `packages/contracts/api-envelope.mjs` | 定义 `ok/data/meta` 与 `ok/error/meta` 的新接口响应格式，并生成 `requestId`。 |
| 新契约样板接口 | `GET /api/v1/health` | 返回服务、知识库统计、集成配置状态和数据来源模式；不回显密钥。旧 `GET /api/health` 保持兼容。 |
| 请求追踪 | `pdf-parser/server.mjs` | 所有响应增加 `X-Request-ID`；新 V1 接口把同一 ID 写入 `meta.requestId`。 |
| 飞书鉴权去重 | `packages/integrations/feishu/tenant-access-token.mjs` | 飞书文档 MCP 与审批客户端共用租户令牌适配器，避免两处鉴权逻辑漂移。 |
| 配置样例与自检 | `.env.example`、`scripts/test-p1-foundations.mjs` | 补齐变量用途样例，验证配置归一化、健康摘要和 API 信封。 |

## 3. 兼容性承诺

- 现有页面使用的 `/api/*`、`/module2/api/*` 保持请求与响应格式不变。
- 飞书同步、飞书审批、MinerU 解析、知识库、SMTP 和政策接口的业务参数不变。
- `.env.local`、`.env.smtp.local` 仍可使用；部署环境变量优先于本地文件。
- 本次不移动 KDB 运行数据、不删除飞书文档、不修改审批实例。

## 4. 使用与验证

```bash
npm run check
npm run test:p1

# 服务启动后，检查新契约样板接口
curl -s http://127.0.0.1:4173/api/v1/health
```

预期响应结构：

```json
{
  "ok": true,
  "data": {
    "service": "stdforge-api",
    "knowledgeBase": {},
    "integrations": {}
  },
  "meta": {
    "requestId": "req_...",
    "mode": "live",
    "source": []
  }
}
```

## 5. 后续 P1 拆分顺序

1. 将 PDF 解析、草案生成、知识库、飞书协同、审批和政策路由拆为领域 handler，并为旧 `/api/*` 提供适配层。
2. 将内存 `jobs` 迁移为持久化 `ParseJob`、`CollectionJob`，新增失败恢复、重试和审计记录。
3. 将模块三 Vite 中的政策和双语 API 迁入统一 API 服务，取消开发/生产两套 API 实现。
4. 以 React/TypeScript 工作台逐步替换模块一、模块二页面，但先做到接口和关键演示链路的功能等价。
