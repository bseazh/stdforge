# 条条是道 ClauseFlow

<p align="center">
  <img src="assets/generated/1786762413865-f156d0dd0512b1e5.png" alt="条条是道：标准采集、结构化、审核、协同与发布流程" width="100%" />
</p>

<p align="center">
  <strong>让每一条标准，都有道可循。</strong><br />
  面向标准化工程师、政策研究人员与评审专家的 AI 标准全生命周期协同平台。
</p>

<p align="center">
  <a href="https://stdforge.hehaizhao.site">在线体验</a> ·
  <a href="docs/PRD.md">产品需求文档</a> ·
  <a href="docs/IMPLEMENTATION_PLAN.md">实施蓝图</a> ·
  <a href="docs/MODULE_1_TECHNICAL_SOLUTION.md">模块一技术方案</a> ·
  <a href="docs/MODULE_1_TECHNICAL_ROADMAPS.md">模块一路线图</a> ·
  <a href="https://my.feishu.cn/wiki/IG9ewEqHqiOmAiktf5LcQbrQnpg">团队需求文档（飞书权限内访问）</a>
</p>

## 项目概述

条条是道（ClauseFlow）将标准公告采集、文件解析、条款级审核、协同修订、评审通知和政策关联放到一条可追溯流程中。黑客松版本聚焦于跑通核心演示闭环，而不是替代正式的标准发布或委员会管理系统。

示范标准：`GB/T 46274-2025《二手家用电器产品品质鉴定规范 洗衣机》`。

## 现阶段可交付内容

| 能力模块 | 当前状态 | 现阶段可完成的任务 |
| --- | --- | --- |
| 标准协同工作台 | 可演示 | 展示标准概览、条款树、审核问题、AI 修改建议、修订记录与评审状态。 |
| 文档解析与知识库 | 可配置运行 | PDF 经 MinerU 转 Markdown 后自动写入 KDB；DOCX、TXT、Markdown、CSV 可直接转文本入库并建立检索索引。 |
| 知识问答 | 可配置运行 | 按标准编写、标准、政策三分区检索；配置 LLM 后生成带片段引用的受控回答。 |
| 条款级审核 | 演示实现 | 展示规范性用语、条件完整性、术语一致性、引用文件等问题与处置状态。 |
| 协同评审通知 | 可配置运行 | 在服务端预设 SMTP 后，发起评审可通知固定评审组；浏览器不能指定收件人。 |
| 飞书文档同步 | 可配置运行 | 解析完成后，将 Markdown 以追加方式同步到有编辑权限的飞书文档。 |
| 公告、组织与政策 | 演示实现 | 用内置数据展示关联标准公告、起草组织、政策解读及原文依据。 |
| 线上部署与备份 | 已上线 | `main` 分支每次推送自动同步至服务器，并更新公开站点。 |

> **当前定位**：已具备可完整演示的黑客松 MVP。页面中的公告采集、企业关系、政策解读和部分审核结论仍是演示数据；它们的真实数据接口已在 PRD 中定义，尚未接入生产数据源。

## 三大业务模块

### 1. 标准协同编制与审核

- 合法上传 PDF / DOCX，保留来源链接、文件哈希和导入记录。
- 将文档组织为范围、规范性引用文件、术语、技术要求、试验方法、附录等条款树。
- 展示可定位的审核问题、依据与修改建议；支持采纳、关闭和修订留痕。
- 发起评审时调用服务端邮件通知，不把收件人或敏感配置暴露给浏览器。

### 2. 公告与组织追踪

- 展示标准号、名称、状态、发布日期、实施日期、ICS / CCS 与来源链接。
- 提供关联标准、起草单位、技术委员会和企业关系的演示入口。
- 为后续合规采集保留来源站点、关键词、采集频率和去重的接口位置。

### 3. 政策收集与解读

- 按来源、产业和地区呈现政策信息。
- 以“适用对象、核心变化、建议动作、风险提示”组织 AI 解读草稿。
- 每条结论必须关联原文证据；未经人工审核不得推送。

## 五分钟演示路径

```text
1. 打开工作台，查看 GB/T 46274-2025 的标准概览与待处理问题
2. 进入“标准编制”，定位一个条款，查看审核依据和 AI 修改建议
3. 采纳建议或保存修订，展示条款级版本留痕
4. 点击“发起评审”，展示服务端固定评审组邮件通知
5. 回到工作台，查看关联公告与政策原文依据
6. 打开 PDF 解析页，上传文件并展示 MinerU 的结构化结果与飞书同步入口
```

## 本地运行

### 仅体验工作台

该部分是零构建依赖的静态页面：

```bash
git clone https://github.com/bseazh/stdforge.git
cd stdforge
open index.html
```

也可使用任意静态 HTTP 服务打开根目录。

### 启动 PDF 解析与通知服务

要求 Node.js 20+、`unzip`、`pdftotext` 命令，以及按需配置的 MinerU / SMTP / 飞书凭据。PDF 入库会同时保留 MinerU 版面解析与原始 PDF 的文本层，以校验表格中的数值和单位。

```bash
npm ci
cp .env.example .env.smtp.local
npm run start:parser
```

默认访问地址为 `http://127.0.0.1:4173`。PDF 解析页面位于 `pdf-parser/index.html`；独立邮件连通性测试页为 `email-test.html`。

知识库管理与问答页面位于 `KDB/index.html`。线上发布后可通过 `https://stdforge.hehaizhao.site/KDB/` 使用；PDF 会在 MinerU 解析完成后自动入库，其他支持的文档格式可直接转换为文本并建立索引。

## 配置与密钥

所有密钥只能通过本地忽略文件或部署平台 Secret 注入，**禁止**写入前端、Kubernetes ConfigMap 或 Git 仓库。

| 配置项 | 用途 | 是否必需 |
| --- | --- | --- |
| `MINERU_TOKEN` | 调用 MinerU 解析 PDF | 仅 PDF 解析需要 |
| `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` | OpenAI 兼容 LLM 的问答生成 | 可选；未配置时仍可检索并返回原文片段 |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS` | 发起评审的服务端邮件通知 | 仅邮件通知需要 |
| `SMTP_FROM`、`NOTIFICATION_RECIPIENTS` | 邮件发件人和固定评审组 | 仅邮件通知需要 |
| `NOTIFICATION_TEST_ACCESS_TOKEN` | 解锁测试收件人查看、添加、勾选和发信 | 邮件测试页需要 |
| `FEISHU_APP_ID`、`FEISHU_APP_SECRET` | 将解析后的 Markdown 追加到飞书文档 | 仅飞书同步需要 |
| `FEISHU_DOCUMENT_URL` | 模块一“同步到飞书协同”的固定目标知识库或 Docx 链接 | 草案同步需要；服务端只追加、不覆盖 |

建议将 SMTP 配置保存在 `.env.smtp.local`，将 MinerU / 飞书配置保存在 `.env.local`。二者均已被 Git 忽略。

### 命令行解析示例

```bash
MINERU_TOKEN='<your-token>' node scripts/mineru-parse.mjs /absolute/path/to/standard.pdf \
  --output data/mineru/GBT46274-2025

unzip -oq data/mineru/GBT46274-2025/mineru-result.zip \
  -d data/mineru/GBT46274-2025

node scripts/build-standard-data.mjs \
  data/mineru/GBT46274-2025 data/standard-data.js
```

`data/standard-data.js` 仅保存页面展示所需的轻量摘要；原始 PDF、完整 Markdown、图片和 MinerU ZIP 默认不提交到 Git。

## 服务接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 返回 PDF 解析、SMTP 与飞书配置状态。 |
| `POST /api/parse` | 上传单个 PDF（演示限制 30 MB）并创建 MinerU 解析任务。 |
| `GET /api/kb` | 返回 KDB 三分区与文档、分块统计。 |
| `GET /api/kb/documents` | 列出已入库文档，可用 `module` 筛选。 |
| `POST /api/kb/imports` | 上传 DOCX、TXT、Markdown 或 CSV 并转换为知识库文本。 |
| `POST /api/kb/ingest` | 统一文档入库接口；PDF 返回异步解析任务，其它支持格式直接返回入库结果。 |
| `POST /api/kb/search` | 在知识库文本中检索，返回可定位片段。 |
| `POST /api/kb/ask` | 先检索后由 LLM 生成带引用答案，响应含可审计的耗时与执行路径。 |
| `POST /api/kb/reindex` | 基于持久化文本重建全部知识库索引。 |
| `POST /api/notifications/review` | 向服务端预配置的评审组发送评审通知。 |
| `GET/POST /api/notifications/test-recipients` | 读取或添加受测试授权码保护的收件人。 |
| `POST /api/notifications/test` | 向已勾选、已授权的测试收件人发送固定模板邮件。 |

后续业务 API 契约见 [PRD](docs/PRD.md)，包括标准导入、条款修订、审核、来源采集与政策解读等接口。

## 项目结构

```text
.
├── index.html / app.js / styles.css  # 标准协同工作台
├── pdf-parser/                       # PDF 上传、MinerU 解析与飞书同步服务
├── KDB/                               # 标准编写、标准、政策三分区的持久化文本与索引和问答页
├── data/standard-data.js             # 页面演示用标准条款摘要
├── scripts/                          # MinerU 解析与数据构建脚本
├── deploy/kubernetes.yaml            # 线上静态服务与 API 反向代理配置
├── .github/workflows/                # 推送后自动同步与部署
├── docs/PRD.md                       # 第一版产品需求与数据模型
└── assets/generated/                 # 品牌图标与 README 展板
```

## 当前架构

```text
PDF / DOCX / TXT / Markdown / CSV
        │
        ├── MinerU 解析服务 ──> PDF Markdown、结构化结果、ZIP
        ├── 文本提取服务 ──> DOCX / TXT / Markdown / CSV 文本
        ├── KDB 三分区 ──> 哈希去重、分块索引、检索依据
        └── 标准协同工作台 ──> 条款树、审核问题、修订与评审
                                      │
                          SMTP 固定评审组通知 / 飞书文档追加
                                      │
                         公告、组织、政策关联（演示数据）
```

部署链路：`git push origin main` → GitHub Actions → 服务器备份目录 → Kubernetes 静态站点与 API 反向代理。

## 已知边界与下一步

| 优先级 | 后续任务 |
| --- | --- |
| P0 | 接入有授权的标准元数据来源；不绕过登录、反爬或下载限制。 |
| P0 | 用数据库持久化标准、条款、审核问题、修订、评论和通知事件。 |
| P1 | 增加 GB/T 1.1 规则包、术语库和引用有效性校验。 |
| P1 | 接入 Yjs / ONLYOFFICE，实现真实多人协作与修订。 |
| P2 | 用受控向量数据库替换当前轻量关键词索引，并加入标准对比、企业关系图谱和角色化推送。 |

## 数据与合规原则

- 原始 PDF / DOCX 作为证据文件保留，编辑行为围绕结构化条款发生；不要直接改原 PDF。
- 仅采集已授权或公开可访问的元数据与文件，保留来源链接、抓取时间和内容哈希。
- AI 只生成候选内容、抽取结果或解读草稿；所有标准修改与政策结论必须人工确认。
- 对需要登录、受访问限制或仅支持在线预览的来源，不绕过技术限制。
