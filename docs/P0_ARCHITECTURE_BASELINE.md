# P0 架构基线与收口方案

## 1. 目的与范围

本文件定义 StdForge 从黑客松 MVP 走向可持续迭代工程的 P0 架构基线。P0 的目标是收口目录、接口、配置、数据模型和演示边界，为后续服务拆分与前端统一提供不破坏现有演示闭环的迁移依据。

P0 **不**移动业务代码、不切换前端框架、不引入数据库，也不改变线上路由。代码重构从 P1 开始；在 P0 完成前，所有接口保持兼容。

## 2. 当前架构事实

```text
根目录静态工作台（模块一）
  -> /api/*
  -> pdf-parser/server.mjs
       -> MinerU / LLM / KDB / SMTP / 飞书 / 政策接口

模块二独立页面与服务
  -> /module2/api/*
  -> module2/std-crawler/serve-demo.mjs
       -> 标准公告采集、预警、组织、竞争分析

模块三 React/Vite 页面
  -> 开发期 Vite API 中间件
  -> 生产期由 pdf-parser/server.mjs 复用政策服务模块
       -> 政策采集、分类、解读、双语能力
```

当前通过 Caddy 将 `/api/*` 转发到解析服务的 `4175` 端口，将 `/module2/api/*` 转发到模块二服务的 `5277` 端口。模块一为原生 HTML/JavaScript，模块二为原生 JavaScript 模块，模块三为 React/TypeScript/Vite；三者尚未共享组件、路由、请求层或领域类型。

## 3. P0 决策

### 3.1 一套产品边界，两个运行时服务

P0 以“一个 StdForge 产品、一个 Web 应用、一个 API 网关边界”为目标。过渡期保留现有的解析服务和模块二服务，但所有新能力必须遵守统一的资源命名、响应信封、错误格式和可追溯字段。

| 层级 | P0 决策 | 现状兼容方式 |
| --- | --- | --- |
| Web | 后续统一为 React + TypeScript 的单一工作台。 | 当前三个页面继续运行，由统一导航逐步接入。 |
| API | 后续统一为 `/api/v1/*`；所有响应采用统一信封。 | 现有 `/api/*`、`/module2/api/*` 不移除，P1 通过适配层兼容。 |
| 领域 | 标准、文档、草案、审核、协同、审批、政策、公告为独立领域。 | 暂保留 `pdf-parser/server.mjs` 现有路由实现。 |
| 集成 | MinerU、飞书、LLM、SMTP、公开数据源均视为外部适配器。 | 现有客户端文件保持不变，P1 移入 integrations。 |
| 数据 | 所有业务输出必须可关联来源、版本、状态和运行模式。 | 内存任务和本地 KDB 保持可用，同时补齐契约字段。 |

### 3.2 目标目录

以下是 P1 开始逐步迁移的目标目录，不要求在 P0 立即移动现有文件：

```text
apps/
  web/                         # 单一 React + TypeScript 工作台
  api/                         # HTTP 入口、认证、任务编排、健康检查
packages/
  contracts/                   # 请求/响应 DTO、错误码、枚举、OpenAPI
  domain/                      # 标准、草案、审核、审批、政策等领域模型与用例
  integrations/                # MinerU、飞书、LLM、SMTP、公开数据源适配器
  ui/                          # 共享组件、主题、图标和页面布局
  config/                      # 环境变量 schema、默认值和配置加载
data/
  seeds/                       # 可复现演示输入、模板与受控演示数据
  fixtures/                    # 测试样本，不进入运行时业务数据
docs/
  architecture/                # 架构决策、接口契约、迁移记录
```

迁移原则：先复制边界与测试，再切流量，最后删除旧入口；不在同一提交中同时改变 UI、接口和业务规则。

## 4. 统一接口契约

### 4.1 版本与响应信封

新接口使用 `/api/v1` 前缀，旧接口继续保留到全部调用方迁移完成。成功和失败响应统一如下：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "req_...",
    "mode": "live",
    "source": []
  }
}
```

```json
{
  "ok": false,
  "error": {
    "code": "INTEGRATION_UNAVAILABLE",
    "message": "MinerU 服务暂不可用",
    "retryable": true
  },
  "meta": {
    "requestId": "req_..."
  }
}
```

`meta.mode` 只能取 `live`、`mock`、`fallback`、`mixed`：

- `live`：已调用外部服务或已授权的公开数据源；
- `mock`：仅使用内置演示或测试数据；
- `fallback`：外部服务不可用后使用明确的降级逻辑；
- `mixed`：同一结果同时含真实来源和受控演示数据。

所有生成、检索、采集和审批结果至少返回来源链接或 `sourceId`、生成时间、输入/输出版本与数据模式；不得把降级结果伪装为真实调用结果。

### 4.2 资源接口

| 领域 | 目标资源 | 现有能力映射 | P0 约束 |
| --- | --- | --- | --- |
| 文档导入与解析 | `POST /api/v1/documents`、`GET /api/v1/parse-jobs/{id}` | `/api/parse`、`/api/jobs/{id}` | 返回文件哈希、解析器版本、任务状态和 `mode`。 |
| 模板与草案 | `GET /api/v1/templates`、`POST /api/v1/drafts` | `/api/demo-inputs`、`/api/reference-templates`、`/api/drafts/generate` | 草案必须记录输入文件、模板、模型/降级模式与待确认项。 |
| 审核与修订 | `GET/POST /api/v1/drafts/{id}/reviews`、`POST /api/v1/revisions` | 模块一页面内演示状态 | 问题、建议、证据、处理人和版本为独立资源。 |
| 飞书协同与审批 | `POST /api/v1/drafts/{id}/syncs`、`POST /api/v1/approvals` | 草案飞书同步、解析任务审批接口 | 只追加、不覆盖；返回飞书链接、实例号和同步标记。 |
| 知识库 | `POST /api/v1/knowledge/documents`、`POST /api/v1/knowledge/query` | `/api/kb/*` | 回答必须携带文档、片段和来源哈希。 |
| 标准公告与组织 | `POST /api/v1/standards/collection-jobs` | `/module2/api/analyze` | 异步任务必须具备可持久化的 jobId 与来源数据模式。 |
| 政策 | `POST /api/v1/policies/collection-jobs`、`POST /api/v1/policies/{id}/interpretations` | `/api/crawl/miit`、`/api/classify/policies`、`/api/interpret/policy` | 分类和解读必须回传原文证据与模型配置版本。 |
| 通知 | `POST /api/v1/notifications/review` | `/api/notifications/review` | 收件人只能由服务端白名单或组织身份决定。 |

## 5. 核心数据模型

P0 固定资源边界和字段语义；P3 再选择 SQLite/PostgreSQL 并落实表结构。

```text
DocumentSource
  id, fileName, mediaType, sourceUrl, hash, storageKey, importedAt, importedBy

ParseJob
  id, documentSourceId, parser, parserVersion, status, progress, mode,
  startedAt, completedAt, errorCode, errorMessage

Template
  id, name, industry, version, schemaJson, sourceDocumentId, status

Draft
  id, standardNo, title, sourceDocumentId, templateId, inputHash,
  modelProvider, modelName, mode, status, createdAt

DraftArtifact
  id, draftId, type(standard|compilation-notes|pre-research), markdown,
  version, hash, generatedAt

FieldTrace
  id, draftArtifactId, clauseId, sourceField, sourceExcerpt, confidence,
  confirmationStatus

ReviewIssue / Revision
  id, draftId, clauseId, ruleId, evidence, suggestion, severity, status,
  author, beforeContent, afterContent, createdAt

CollaborationSync / ApprovalInstance
  id, draftId, draftVersion, provider, remoteUrl, remoteId, marker,
  status, instanceCode, syncedAt, approvedAt

KnowledgeDocument / KnowledgeChunk
  id, documentSourceId, module, version, chunkNo, text, hash, indexedAt

CollectionJob / PolicyRecord / StandardRecord
  id, domain, sourceUrl, sourceName, collectedAt, mode, status, evidence
```

统一状态机：

```text
Draft: draft -> in_review -> approved -> archived
ParseJob / CollectionJob: queued -> running -> succeeded | failed | cancelled
ApprovalInstance: pending -> approved | rejected | cancelled
```

## 6. 环境配置与密钥归属

`.env.example` 只记录变量名、用途和安全说明；`.env.local`、`.env.smtp.local` 以及部署 Secret 只保存具体值，严禁提交。生产环境通过 GitHub Secrets 注入，浏览器不得读取任何令牌。

| 配置组 | 变量 | 使用边界 |
| --- | --- | --- |
| 文档解析 | `MINERU_TOKEN`、`PDFTOTEXT_BIN` | 仅 API 服务调用 MinerU 和本地文本层校验。 |
| 通用 LLM | `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | 草案生成、知识库受控问答；未配置时显式降级。 |
| 政策与双语 LLM | `POLICY_LLM_*`、`BILINGUAL_LLM_*` | 政策分类/解读和双语翻译；可与通用 LLM 分开计费、审计。 |
| 飞书 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DOCUMENT_URL`、`FEISHU_APPROVAL_CODE`、`FEISHU_INITIATOR_OPEN_ID` | 仅服务端执行文档同步与审批实例创建。 |
| 邮件 | `SMTP_*`、`NOTIFICATION_RECIPIENTS`、`NOTIFICATION_TEST_*` | 服务端白名单通知，禁止由浏览器传入任意收件人。 |
| 模块二 | `STD_LLM_*`、`MAIL_SERVER_URL`、`MAIL_SYNC_TOKEN` | 模块二分析和与主 API 的受控通信。 |
| 运行时 | `HOST`、`PORT`、`NOTIFICATION_COOLDOWN_MS` | 由开发/部署环境配置，不写入前端。 |

P1 引入配置 schema：启动时校验变量格式、将“未配置”“配置错误”“第三方不可达”区分为不同健康检查状态；健康接口不得回显密钥、文档正文或审批人身份。

## 7. Mock、真实与降级能力台账

| 能力 | 当前模式 | P0 标记要求 | 生产化缺口 |
| --- | --- | --- | --- |
| 内置技术要求与参考 PDF | `mock`，来自受控演示文件 | 页面和 API 返回 `mode: mock`、文件来源与版本。 | 企业文件上传、模板管理、权限与存储。 |
| PDF 版面解析 | 配置 MinerU 后为 `live` | 返回任务 ID、MinerU 状态、结果哈希和失败可重试标识。 | 异步队列、对象存储、任务恢复。 |
| AI 草案生成 | 配置 LLM 为 `live`；不可用时确定性 `fallback` | 返回模型名或 `fallback` 原因，保留待确认字段。 | Prompt 版本、用量审计、人工审批策略。 |
| 飞书文档同步 | 配置应用与目标链接后为 `live` | 返回文档链接、幂等 marker 和追加时间。 | 草案版本双向回写、组织权限映射。 |
| 飞书审批 | 配置审批码和发起人后为 `live` | 返回审批实例号和状态，关联草案版本。 | Webhook 回调、超时/退回策略、发布策略。 |
| 知识库检索 | 本地 KDB 为可运行持久化索引 | 返回 `documentId`、chunk、hash、引用片段。 | 数据库、向量索引、访问控制。 |
| 标准公告与组织 | 公开采集 + 受控演示兜底，可能为 `mixed` | 每条记录标示来源和 `isDemo`，不得混淆。 | 授权数据源、调度、持久化和去重。 |
| 政策采集与解读 | 公开数据源 + LLM，按配置真实调用 | 解读必须带原文证据、抓取时间和模型模式。 | 数据源治理、审核发布与版本对比。 |

## 8. 两日实施清单

### 第 1 天：边界与契约

1. 审核本文件中的目录、资源名称、状态机和数据模型，确定不再新增临时顶层目录。
2. 建立 `packages/contracts` 的 DTO、错误码和 OpenAPI 初稿，但暂不改旧路由。
3. 建立环境变量 schema 和 `.env.example` 注释模板；核对 GitHub Secrets 与生产健康检查。
4. 为现有 `/api/*`、`/module2/api/*` 建立接口台账，标记调用方、模式和迁移目标。

### 第 2 天：迁移护栏

1. 为 API 响应补充 `requestId`、`mode`、`source`、`error.code` 的兼容字段。
2. 将内置演示输入、模板和模块二受控数据统一登记为 seed，不混入真实业务数据。
3. 在 CI 增加契约校验、环境变量校验和现有演示冒烟测试入口。
4. 输出 P1 迁移清单：先抽外部适配器，再拆 API 领域模块，最后切换前端页面。

## 9. P0 验收标准

1. 团队能用本文件解释每个功能的运行位置、数据来源、真实/Mock/降级状态和后续归属。
2. 新增接口不再直接返回无来源、无模式、无错误码的结果。
3. 所有密钥只出现于本地忽略配置或部署 Secret，README、前端和接口响应均不出现具体值。
4. 旧页面、`/api/*` 和 `/module2/api/*` 在 P1 前不发生破坏性变化。
5. 后续 PR 必须标注涉及的领域、契约变更、数据模式和迁移/回滚方式。

## 10. P1 起步顺序

1. 抽取 `packages/integrations`：MinerU、飞书、LLM、SMTP、公开数据源。
2. 拆分 `apps/api`：documents、drafts、knowledge、collaboration、approvals、policies、standards 六个领域路由。
3. 将任务表由内存迁移为持久化 `ParseJob`、`CollectionJob`。
4. 以模块三 React/TypeScript 技术栈为基础，逐步接入模块一和模块二页面；不一次性重写所有业务交互。
5. 当新页面和 `/api/v1` 达到功能等价并完成回归后，再删除旧入口和重复实现。
