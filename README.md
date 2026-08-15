# 条条是道 ClauseFlow

<p align="center">
  <img src="assets/generated/1786762413865-f156d0dd0512b1e5.png" alt="条条是道：标准采集、结构化、审核、协同与发布流程" width="100%" />
</p>

条条是道（ClauseFlow）是一个面向标准化工程师与政策研究人员的 AI 标准全生命周期协同平台演示。它把“标准公告采集、文件解析、条款级审核与协同修订、政策解读”放在同一条可追溯流程中。

## 演示范围

- 模块一：导入 PDF/DOCX、条款结构化、规范性审核、AI 修改建议、条款级修订留痕、协同评审。
- 模块二：公开标准网站的元数据采集、关联标准追踪、起草单位/领域关联入口。
- 模块三：政策采集后的分类、原文依据、AI 解读草稿和人工审核状态。

这是一个零构建依赖的前端原型。直接在浏览器打开 `index.html` 即可运行，除邮件通知外的交互均使用模拟数据，不会连接外部站点或下载文件。

## 本地运行

```bash
git clone https://github.com/bseazh/stdforge.git
cd stdforge
open index.html
```

也可以用任意静态 HTTP 服务打开目录。

## 邮件通知

“发起评审”会调用服务端 `POST /api/notifications/review`，向 `NOTIFICATION_RECIPIENTS` 中预先配置的地址发送评审通知。收件人、邮件正文和发件地址均不由浏览器传入，因此公开页面不会成为邮件转发器；服务端默认将连续发送限制为每 60 秒一次。

将 `.env.example` 复制为本机 `.env.smtp.local` 并填写 SMTP 授权码，`.env.smtp.local` 已被 Git 忽略，且不会覆盖已有的飞书 `.env.local`。163 邮箱使用 `smtp.163.com:465` 和 SSL：

```bash
cd stdforge
cp .env.example .env.smtp.local
npm run start:parser
```

部署环境中的 Caddy 已将主工作台的 `/api/*` 转发到该服务，因此进入“标准编制”后点击“发起评审”即可发送通知。不要把 SMTP 授权码写进前端代码、Kubernetes ConfigMap 或 Git 仓库；生产环境应改用部署平台的 Secret 注入相同环境变量。

独立测试页面位于 `/email-test.html`，会先检查 `/api/health` 的 SMTP 配置状态，再调用 `POST /api/notifications/test` 发送固定模板的连通性测试邮件。

## MinerU PDF 解析

MinerU 令牌只能通过环境变量传入，禁止写入仓库、前端、脚本或任何文件。解析结果默认存放在被 Git 忽略的 `data/mineru/` 中。

```bash
MINERU_TOKEN='<your-token>' node scripts/mineru-parse.mjs /absolute/path/to/standard.pdf --output data/mineru/GBT46274-2025
unzip -oq data/mineru/GBT46274-2025/mineru-result.zip -d data/mineru/GBT46274-2025
node scripts/build-standard-data.mjs data/mineru/GBT46274-2025 data/standard-data.js
```

`data/standard-data.js` 是页面可直接加载的轻量解析摘要；它保存标准编号、标题、页数、解析块数、章节标题和引用文件，不提交原始 PDF、完整 Markdown、图像或 MinerU ZIP。

## 目录

```text
.
├── index.html       # 单页演示界面
├── styles.css       # 响应式样式
├── app.js           # 演示状态与交互流程
├── pdf-parser/      # 独立 PDF 上传、解析和下载页面
└── docs/PRD.md      # 第一版产品需求文档
```

## 目标生产架构

```text
来源站点 / 用户上传
        -> 采集与存证服务
        -> PDF/DOCX 解析服务
        -> 标准条款树 + 关系数据库 + 对象存储
        -> 规则审核 / RAG / LLM 辅助服务
        -> 协同编辑、评审、发布与推送
```

原始 PDF/DOCX 必须作为不可修改的证据文件保留。编辑、评论、审核和版本比较都围绕结构化条款发生，最终再渲染为 DOCX/PDF；不要直接修改原 PDF。

## 可复用的开源组件

| 能力 | 建议项目 | 生产环境用途 |
| --- | --- | --- |
| 标准站点采集 | [Scrapy](https://github.com/scrapy/scrapy) | 定时采集公开元数据、公告和来源链接 |
| 动态页面采集 | [scrapy-playwright](https://github.com/scrapy-plugins/scrapy-playwright) | 在获得合法访问授权后处理 JS 页面 |
| 文档解析 | [Docling](https://github.com/docling-project/docling)、[MinerU](https://github.com/opendatalab/MinerU) | PDF/DOCX 到 Markdown、JSON、表格和版面结构 |
| 文档协同 | [ONLYOFFICE DocumentServer](https://github.com/ONLYOFFICE/DocumentServer) | Word 在线编辑、修订和批注 |
| 条款实时协作 | [Yjs](https://github.com/yjs/yjs) | 结构化条款的多人实时编辑 |
| 标准即代码 | [Metanorma](https://github.com/metanorma/metanorma) | 用结构化源数据生成标准文档 |
| 差异比对 | [diff-match-patch](https://github.com/google/diff-match-patch) | 生成条款级制修订说明 |

## 数据与合规边界

- 对公开标准页面，采集标准号、名称、日期、状态、来源链接等公开元数据，并保留抓取时间与来源哈希。
- 是否下载、保存、解析和分发标准全文，必须遵守来源网站规则、标准文本使用许可和组织内部授权。
- 对需要登录、受访问限制或仅支持在线预览的来源，不绕过技术限制；改由合法接口、人工上传或授权下载接入。
- 政策解读只能作为草稿，结论必须保留原文依据，并由指定业务人员审核后发布。
