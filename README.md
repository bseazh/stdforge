# StdForge

StdForge 是一个面向标准化工程师与政策研究人员的标准全生命周期协同平台演示。它把“标准公告采集、文件解析、条款级审核与协同修订、政策解读”放在同一条可追溯流程中。

## 演示范围

- 模块一：导入 PDF/DOCX、条款结构化、规范性审核、AI 修改建议、条款级修订留痕、协同评审。
- 模块二：公开标准网站的元数据采集、关联标准追踪、起草单位/领域关联入口。
- 模块三：政策采集后的分类、原文依据、AI 解读草稿和人工审核状态。

这是一个零构建依赖的前端原型。直接在浏览器打开 `index.html` 即可运行，所有交互使用模拟数据，不会连接外部站点或下载文件。

## 本地运行

```bash
git clone https://github.com/bseazh/stdforge.git
cd stdforge
open index.html
```

也可以用任意静态 HTTP 服务打开目录。

## 目录

```text
.
├── index.html       # 单页演示界面
├── styles.css       # 响应式样式
├── app.js           # 演示状态与交互流程
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
