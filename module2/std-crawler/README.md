# std.samr.gov.cn 标准数据爬取方案（案例8：竞争对手标准布局分析）

> 状态：接口与字段已真实验证，原型可运行（`crawl-samr.mjs`）
> 验证日期：2026-08-15
> 关联项目：`Policyanalysize`（模块三爬取/分类管线可复用）

## 0. 结论摘要

1. **可爬、无需登录**：全国标准信息公共服务平台提供官方高级检索 JSON 接口 `/gb/search/gbAdvancedSearchPage`，GET 请求直接返回结构化数据，与前端 bootstrap-table 使用同一接口。
2. **一个接口覆盖四类数据**：`tid` 参数切换国家标准（2）、行业标准（3）、地方标准（4）、国家标准计划（1）。
3. **字段足够支撑案例8的四个统计维度**：列表/详情自带标准号、名称、状态、发布日期、实施日期、起草单位、归口技术委员会、ICS/CCS、采标情况、代替标准、计划号与阶段。
4. **唯一缺口是行业标准起草单位**：SAMR 列表/详情对 QB/T 部分记录不公开起草单位（部分记录又公开），需从 hbba.sacinfo.org.cn best-effort 补抓，或在二期接工信部标准平台补齐。
5. **原型已验证**：2021-2026 窗口内，关键词“冰箱/保鲜/食品保鲜”× 4 类标准，去重后取到 60 条真实记录，含案例8 关键标准 GB/T 44494-2024《家用和类似用途制冷器具 食品保鲜》及其起草单位列表。

## 1. 数据源矩阵

| 数据源 | 内容 | 接口 | 状态 | 起草单位 |
| --- | --- | --- | --- | --- |
| std.samr.gov.cn（国家） | 国家标准 GB/GB/T | `/gb/search/gbAdvancedSearchPage?tid=2` | ✅ 已验证 | ✅ 列表直取 + 详情确认 |
| std.samr.gov.cn（行业） | 行业标准 QB/JB/QC/NB 等 | 同上 `tid=3` | ✅ 已验证 | ⚠️ 部分记录公开，缺失时走 hbba |
| std.samr.gov.cn（地方） | 地方标准 DB | 同上 `tid=4` | ✅ 已验证 | 详情页字段（未全量验证） |
| std.samr.gov.cn（计划） | 国家标准立项/计划（含阶段） | 同上 `tid=1` | ✅ 已验证 | ✅ 列表直取（含“等”字） |
| hbba.sacinfo.org.cn | 行业标准备案/详情 | `POST /stdQueryList` + `/stdDetail/{pk}` | ✅ 已验证 | ⚠️ best-effort，部分记录为空 |
| std.miit.gov.cn | 工信部标准项目（行业标准计划/报批） | `/kjsStandproject/...`（Vue SPA） | 🔶 可达，接口契约待逆向 | 预期可补全行业标准缺口，二期 |

## 2. 接口规格（已实测）

### 2.1 检索接口

```
GET https://std.samr.gov.cn/gb/search/gbAdvancedSearchPage
```

关键参数：

| 参数 | 含义 | 备注 |
| --- | --- | --- |
| `tid` | 检索类型 | 1=国家标准计划，2=国家标准，3=行业标准，4=地方标准 |
| `std_p7` | 标准号 | 如 `GB/T 44494` |
| `std_p8` | 中文标准/项目名称 | 子串匹配，主要检索入口 |
| `std_p9` | 英文名称 | 可选 |
| `std_p10` / `std_p11` | 发布日期从/到 | `YYYY-MM-DD`，已验证生效 |
| `std_p12` / `std_p13` | 实施日期从/到 | 可选 |
| `std_p14` / `std_p15` | ICS / CCS 分类号 | 可用于白名单过滤 |
| `std_p18` | 起草单位 | 可反向按企业检索 |
| `std_p19` / `std_p20` / `std_p21` | 采标号 / 采标类别 / 采用程度 | 可选 |
| `limit` / `offset` | 分页 | 已验证；`offset=(页码-1)×limit` |

返回结构：

```json
{ "total": 33, "pageNumber": 1, "rows": [ { ...标准字段... } ] }
```

### 2.2 详情页（按类型区分路径）

| 类型 | 路径 |
| --- | --- |
| 国家标准 / 计划 | `/gb/search/gbDetailed?id={id}` |
| 行业标准 | `/hb/search/stdHBDetailed?id={id}`（已验证） |
| 地方标准 | `/db/search/stdDBDetailed?id={id}`（按同站规律，未全量验证） |

### 2.3 实测命中数（2026-08-15，窗口 2021-01-01 ~ 2026-08-15）

| 关键词 | 国家标准 | 行业标准 | 国家标准计划 | 地方标准 |
| --- | --- | --- | --- | --- |
| 冰箱 | 9 | 4 | 38 | 2 |
| 保鲜 | 5 | 12 | 20 | 69 |
| 食品保鲜 | 2 | 0 | 3 | 0 |

去重后共 60 条。关键样例：

- `GB/T 44494-2024 家用和类似用途制冷器具 食品保鲜`（起草单位 23 家，海尔第一、海信第三、格力/美菱/美的均在列）
- `QB/T 5510-2021 家用电冰箱保鲜性能试验方法`（行业标准，起草单位未公开）
- `DB3411/T 0053-2024 家用电冰箱保鲜货架期评价方法`（安徽地方标准，与美菱相关）
- `NB/T 10307-2019 电冰箱用化霜加热器`（发布早于窗口，被日期过滤正确排除）

### 2.4 简单检索入口（首页搜索框，已纳入方案）

```
首页：   https://std.samr.gov.cn/search/std?q=冰箱
结果页： https://std.samr.gov.cn/search/stdPage?q=冰箱&tid=&pageNo=1
```

- 服务端渲染 HTML，每页 10 条，混合类型（国家标准/行业标准/地方标准/计划），翻页参数为 `pageNo`（已验证）；
- 行内显式字段：标准号、中文名称、状态、ICS、CCS、英文标题、归口单位、发布日期；
- 详情链接由 `tid` + `pid` 拼出：`BV_HB → /hb/search/stdHBDetailed?id=`、`BV_DB → /db/search/stdDBDetailed?id=`、其余 → `/gb/search/gbDetailed?id=`（与页面内脚本一致，已验证）；
- 用途：作为高召回入口（实测“冰箱”约 82 条 vs 高级检索名称命中 33 条），列表字段不足部分由详情页显式键值 + LLM 补齐。

## 3. 字段字典（列表接口 → 业务字段 → 案例8标签）

| 列表接口字段 | 业务字段 | 说明 | 对应标签维度 |
| --- | --- | --- | --- |
| `C_STD_CODE` / `STD_CODE` | standardNo | 标准号 | 标准级别/性质规则依据 |
| `C_C_NAME` / `C_NAME` | title | 中文名称 | 技术领域匹配 |
| `C_E_NAME` / `E_NAME` | titleEn | 英文名称 | — |
| `ISSUE_DATE` / `ACT_DATE` | publishedAt / effectiveAt | 发布/实施日期 | 时间趋势 |
| `STATE` / `STATE2` / `G_STATE` | status | 现行/即将实施/废止/被代替 | 标准状态 |
| `STD_DOMAIN` / `G_STD_DOMAIN` | domain | 国家标准/行业标准/计划 | 标准级别 |
| `STD_NATURE` / `G_STD_NATURE` | nature | 推荐性/强制性 | 标准性质 |
| `STD_TYPE` | standardType | 产品/方法/基础/管理 | 标准类型 |
| `DRAFT_UNIT` | draftUnits | 起草单位（顿号分隔，首位通常为牵头） | 主导/参与、企业主体、地域 |
| `DRAFT_STAFF` | draftStaff | 起草人 | 明细下钻 |
| `TA_NAME` / `TA_CODE` | tc / tcCode | 归口技术委员会（如 TC46） | 归口组织 |
| `TM_NAME` / `TM_CODE` | sc / scCode | 执行分技术委员会（如 TC46SC1） | 归口组织 |
| `CD_NAME` | issuer | 主管部门 | 标准级别佐证 |
| `UTA_NAME` | reporter | 上报单位 | — |
| `ICS` / `ICS_NAME1_FULL` | ics / icsFull | 国际标准分类号及全称 | 技术领域 |
| `CCS` | ccs | 中国标准分类号（如 Y61 家电） | 技术领域 |
| `ADOPT_TYPE` | adoptedType | 采标类型（无/ISO/IEC…） | 采标情况 |
| `TOTAL_REPE` | replaces | 代替标准号 | 版本链/被代替 |
| `PLAN_CODE` / `C_PLAN_CODE` | planCode | 计划号 | 计划↔标准关联 |
| `ISSUE_ANN_NO` | issueAnnouncementNo | 发布公告号 | 溯源 |
| `ORG_SCOPE` | orgScope | 行业范围（电器;轻工） | 技术领域佐证 |
| `OPEN_DOWNLOAD_STATUS` | openDownload | 文本是否公开下载 | 报告引用 |
| 计划专用：`STD_FORM` | planForm | Z=制定 / X=修订 | 立项类型 |
| 计划专用：`STATE` / `CURRENT_LINK` / `STAGE_CODE` | status / stage | 正在起草/正在审批等阶段 | 立项追踪 |
| 计划专用：`SEND_DATE` / `END_DATE` | deadline | 下达/截止日期 | 立项追踪 |

## 4. 查询策略

### 4.1 关键词矩阵（解决标题匹配召回不足）

高级检索只按“中文标准名称”做子串匹配，`无霜/化霜/微冻` 等技术词极少出现在标准标题中（实测近5年窗口内 0 命中），因此：

1. **标题词扩召回**：冰箱、冷藏、制冷器具、保鲜、食品保鲜、冷冻、冷柜 等；
2. **ICS/CCS 白名单收窄**：仅保留家电制冷相关分类（ICS 97.040.30 家用制冷设备、CCS Y61 家用电器、Y60 等），把“保鲜”命中的农业/食品类标准过滤掉；
3. **技术词二级标注**：`无霜/化霜/微冻/保湿/控温/智能保鲜/零度保鲜` 作为“技术领域标签词库”，对标题 + 详情页正文 + 相近标准做命中标注；
4. **LLM 细分**：对白名单内标准，用大模型从标题/范围补充分类（复用 `Policyanalysize/server/policy-classifier.mjs` 的适配器模式）。

### 4.2 类型矩阵

默认枚举 `gb, hb, db, plan` 四类，逐关键词逐类型分页抓取；企业侧默认还要加“按起草单位反查”（`std_p18=海信/美的/海尔/格力/美菱`）。

### 4.3 日期窗口

`std_p10`/`std_p11` 传发布窗口；案例8 使用近5年（如 2021-01-01 ~ 2026-08-15）。计划类无发布日期的记录不受影响（按下达时间排序）。

## 5. 爬取流水线（与 Policyanalysize 同构）

```text
关键词 × 类型矩阵
  → 分页抓取（limit/offset，900ms 限速，15s 超时，3 次重试，可中断）
  → 规范化（字段字典映射，脏值清洗）
  → 去重（id / 标准号+状态 / 计划号）
  → 详情补抓（按类型选路径，并行拉取，默认并发 6）
  → 显式键值解析（仅读取页面明确成对的 key→value，见 5.2）
  → LLM 结构化提取（输入 = 列表字段 + 显式键值 + 详情文本，输出完整 JSON，见 5.3）
  → 行业标准起草单位补抓（hbba POST /stdQueryList → /stdDetail/{pk}，best-effort）
  → 落库（SQLite/JSON；保留 sourceUrl 溯源）
  → 定时增量（每日滚动 90 天 + 近5年全量按月刷新）
```

### 5.2 提取原则：LLM 优先，显式键值例外

- **结构化信息统一交给 LLM 提取**（起草单位、起草人、归口/执行单位、主管部门、标准类型、技术领域、范围摘要、状态与日期校核等），不写启发式正则从散文里抠字段；
- **唯一例外**：网页已明确成对出现的 key→value 直接取——
  - 详情页基础信息区：`<dt class="basicInfo-item name">标准号</dt><dd class="basicInfo-item value">GB/T 44494-2024</dd>`；
  - 详情页列表区：`<h2 class="title-text">起草单位/起草人</h2>` 后逐条 `<dd class="basicInfo-item value">…</dd>`（samr）或 `<p>单位一、单位二</p>`（hbba）；
  - 检索接口返回的 JSON 字段（官方结构化字段，直接映射，不做模型猜测）；
- LLM 未配置时降级为“仅显式键值 + 列表字段”，不生成伪结论。

### 5.3 LLM 结构化提取契约

- 协议：OpenAI Chat Completions（复用 `Policyanalysize/server/policy-classifier.mjs` 的适配模式）；
- 输入：标准列表字段 + `detailKeyValues`（页面显式键值，优先采信）+ `detailText`（详情页清洗文本）；
- 输出：`draftUnits / draftStaff / tc / sc / issuer / standardType / techAreas / scope / status / publishedAt / effectiveAt / replaces / ics / ccs / confidence / reasoning / evidence`；
- `techAreas` 候选词：保鲜、微冻、无霜、化霜、保湿、精准控温、智能保鲜、零度保鲜、能效、安全、其他（可多标签）；
- 合并规则：LLM 结果补齐空字段，已有值（列表/显式键值）优先保留；置信度与证据随行保存，供人工复核。
- 容错：超时 90s、空响应/缺失 choices 自动重试 3 次（3s/6s 退避）；实测 DeepSeek（deepseek-v4-flash）对 10 条记录 10/10 提取成功，`QB/T 8144-2025 → 化霜`、`GB 12021.2-2025 → 能效` 等标签识别正确。

### 5.1 去重与增量规则

- 主键：`标准号 + 状态`；计划用 `计划号`；
- 版本链：`TOTAL_REPE`（被代替）+ 计划号 ↔ 标准号（`C_PLAN_CODE` = `PLAN_CODE`）识别“计划 → 发布”状态流转；
- 增量：按 `SYS_INPUTIME` 或发布日期滚动，避免全量重爬；
- 状态变化：同一标准号在计划库（正在起草/审批）与标准库（现行）各一条，合并时以“发布状态优先”。

### 5.2 限速与访问策略

- 页间延时 900ms、关键词间 500ms、详情并发 ≤3；
- 固定 UA + Referer（模拟浏览器），超时 15s、失败指数退避重试（700ms×n）；
- 服务端无 robots.txt（实测 404），按政府公开数据合理低频访问，不做并发放大；
- 所有请求支持 AbortSignal 中断（沿用 `miit-source.mjs` 模式）。

## 6. 分类标签管线（案例8 的 12 个维度）

| 维度 | 标签值 | 数据来源 | 生成方式 |
| --- | --- | --- | --- |
| 标准级别 | 国家标准/行业标准/地方标准/计划 | `STD_DOMAIN` | 直取 |
| 标准性质 | 推荐性/强制性 | `STD_NATURE` | 直取 |
| 标准状态 | 现行/即将实施/废止/被代替/制修订中 | `STATE` | 直取 |
| 时间 | 发布年份、实施年份 | `ISSUE_DATE`/`ACT_DATE` | 直取 |
| 起草角色 | 主导/参与/未参与 | `DRAFT_UNIT` 排序 | 规则（首位=牵头） |
| 企业主体 | 海信系/美的/海尔/格力/美菱/其他 | `DRAFT_UNIT` 名称归一化 | 规则 + 集团映射表 |
| 技术领域 | 保鲜/微冻/无霜/化霜/保湿/控温/智能保鲜/零度保鲜/能效/安全/其他 | 标题+详情+ICS/CCS | 规则词库 + LLM 细分 |
| 地域 | 广东/山东/安徽/其他 | 起草单位注册地 | 外部知识库（企查查类）或 LLM |
| 归口组织 | TC46/TC46SC1/TC119/其他 | `TA_NAME`/`TM_NAME` | 直取 |
| 标准类型 | 产品/方法/基础/管理 | `STD_TYPE` | 直取，缺失时 LLM |
| 采标情况 | 采用 ISO/IEC/非采标 | `ADOPT_TYPE` | 直取 |
| 相关度 | 高/中/低 | 标题+ICS 命中数与权重 | 规则 |

## 7. 案例8 四张图表的数据映射

| 图表 | 统计口径 | 数据来源 |
| --- | --- | --- |
| 主导标准数量柱状图 | 企业 × 起草角色计数 | `DRAFT_UNIT` 首位=主导、其余=参与；集团映射后聚合 |
| 技术领域分布饼图 | 标准 × 技术标签（可多标签） | 标题词库 + ICS/CCS + LLM 细分 |
| 时间趋势折线图 | 年度 × 企业 × 领域计数 | `ISSUE_DATE` 按年聚合 |
| 企业分布地图 | 省份 × 标准数量 | `DRAFT_UNIT` → 集团 → 注册地知识库 |

下钻明细 = 对应分组条件下的标准列表（标准号/名称/状态/起草单位/原文链接）。

## 8. std.miit.gov.cn 可选扩展（二期）

**结论：能连，值得做，但本轮未完成接口契约逆向。**

- 可达性：✅ HTTP 200，Vue3 SPA，`serverConfig.js` 正常；
- 已定位 API 前缀：`/kjsStandproject/`，公开查询相关路径包括：
  - `front/project/projectInfo/queryProjectInfoByPageGK`（公开项目分页）
  - `front/project/projectInfo/queryProjectInfo`、`queryProjectInfoByPageGuest`
  - `front/project/projectInfo/queryGSInfoPublicity`、`queryHavePublicityProject`（公示）
  - `front/project/projectBaopiInfo/queryProjectBaopiBzyfbInfoByPage` 等（报批信息）
- 价值：行业标准（QB 等）的立项/报批公示通常带起草单位，可补全 SAMR/hbba 缺失的行业标准起草人信息（如 QB/T 5510-2021）；
- 下一步：用无头浏览器抓取页面请求确认 POST 参数契约，再按本方案的字段规范落库。若时间紧，案例8 主数据依赖 SAMR 已足够演示。

## 9. 原型文件与运行

```text
std-crawler/
  核心代码
    crawl-samr.mjs            # 爬虫：高级/简单检索、去重、并行详情补抓、显式键值解析、LLM 提取、hbba 补抓、CLI
    case8-pipeline.mjs        # 案例8分析管线：可配置查询 → 爬取 → 领域过滤 → 详情 → LLM → 合并 → 聚合 → LLM结论/报告标题
    serve-demo.mjs            # 本地服务：托管演示页 + 异步分析任务接口（POST 创建 / GET 轮询）
    demo-app.js               # 演示页应用：查询配置/历史、任务轮询、图表渲染、调试面板、导出
    run-case8-scenario.mjs    # CLI 场景脚本：读 case8-config.json → 全流程 → 输出到 output/
  配置
    case8-config.json         # 默认查询条件（关键词/类型/日期/并发/集团映射），页面与 CLI 共用
    ds配置.json               # LLM API 配置（含密钥，已加入 .gitignore，禁止提交）
  测试
    test-llm-extract.mjs      # 显式键值解析 / 无配置降级 / mock 模型端到端
    test-demo-server.mjs      # 任务流冒烟测试（真实爬取 + LLM + 调试信息）
    test-page-render.mjs      # 无头浏览器端到端（空状态/配置历史/分析/调试面板/本地时间日志）
  文档
    README.md                 # 本方案
  输出（可由 run-case8-scenario.mjs 重新生成）
    output/case8-scenario-report.md   # 场景报告
    output/case8-scenario-data.json   # 聚合明细
    output/case8-scenario-raw.json    # LLM 提取后的完整原始记录（--reuse 复用）
```

运行：

```powershell
# 场景脚本（默认读 case8-config.json；--reuse 复用 output/case8-scenario-raw.json 重算）
node run-case8-scenario.mjs
node run-case8-scenario.mjs --reuse

# 演示服务（真实实时分析）
node serve-demo.mjs

# 自动化测试
node test-llm-extract.mjs
node test-demo-server.mjs 3
node test-page-render.mjs

# 爬虫 CLI（高级/简单检索调试）
node crawl-samr.mjs --keywords "冰箱,保鲜" --types gb,hb,plan --start 2021-01-01 --end 2026-08-15 --maxPages 1 --pageSize 20
```

## 10. 演示页接入（competitor-analysis-demo.html）

与 `std-crawler/` 同级的 `competitor-analysis-demo.html` 已重设计为**查询条件可配置 + 真实爬取 + LLM 实时分析**（所有路径均为相对路径，整个目录可整体迁移）：

| 文件 | 作用 |
| --- | --- |
| `competitor-analysis-demo.html` | 演示大盘：查询条件面板 + 进度日志 + 四图表 + AI结论 + 下钻 + 导出 |
| `demo-app.js` | 页面应用：配置校验 → 异步任务轮询 → 结果渲染 → 导出（打印/CSV） |
| `case8-pipeline.mjs` | 共享分析管线：可配置查询 → 爬取 → 详情 → LLM 提取 → 合并 → 聚合 → LLM 结论/报告标题 |
| `serve-demo.mjs` | 本地服务：托管页面 + 异步分析任务接口（POST 创建 / GET 轮询进度） |
| `test-demo-server.mjs` | 任务流冒烟测试（真实爬取 + LLM，已通过） |
| `test-page-render.mjs` | 无头浏览器渲染测试（配置面板/图表/无 JS 错误，已通过） |

使用方式：

```powershell
# 启动服务，然后打开 http://127.0.0.1:5277
node std-crawler/serve-demo.mjs
```

行为说明：

- **查询条件可配置**：关键词（逗号分隔多词）、标准类型（国标/行标/地标/计划）、发布日期范围、主导判定口径（首位/前3位）、分析对象与集团关联（名称/关键词/注册地可编辑增删）；
- **配置历史**：查询条件可保存到历史（localStorage），支持加载切换、删除管理；页面会自动恢复上次使用的配置，但**不会自动触发爬取**；
- **初始空状态**：刚进入页面时不展示任何统计/图表/结论，只有“尚未开始分析”占位提示；配置完成点击「开始实时分析」后才真实爬取并展示结果；
- **真实实时分析**：点击“开始实时分析” → 后端真实爬取 std.samr.gov.cn → 详情页补抓 → LLM 结构化提取 → 计划↔发布合并 → 聚合；进度通过 `/api/analyze/{jobId}` 轮询实时展示（检索/详情/LLM/结论各阶段日志）；
- **AI 结论与报告标题由 LLM 生成**：基于实际统计与标准明细生成 3 条结论（竞争格局/趋势洞察/机会识别）和报告标题（如“冰箱保鲜标准竞争分析报告”），非硬编码；
- **调试模式**：配置面板勾选「调试模式」后，后端管线采集全过程诊断信息（检索命中统计、领域过滤逐条丢弃原因、hbba 补抓状态、详情页补抓逐条状态/错误/键值数、LLM 逐条状态/错误/技术标签/置信度、计划↔发布合并、各阶段耗时、警告），页面以可折叠面板展示并支持「导出调试日志(JSON)」；任务失败时提示查看服务端控制台；
- **日志时间本地化**：进度日志时间按浏览器本地时区显示（后端为 UTC ISO，前端自动转换），不再出现相差 8 小时的问题；
- 四图口径：柱状图=企业参与标准数量（tooltip 含主导数）；饼图=LLM 技术领域标签分布；折线=各企业年度参与数量；地图=按注册地省份聚合；
- 下钻：点击柱状图柱子查看该企业标准明细（标准号、名称、技术领域、年份、主导/参与、官方链接）；
- 导出：Excel 导出为真实数据 CSV（含全部明细与官方链接）；PDF 走打印视图（报告标题/数据来源/明细由当前分析结果动态生成）；
- 静态双击 HTML 时提示启动服务；服务模式下页面仅提示连接状态，不会自动爬取；
- 口径提示：主导判定可选“起草单位首位 / 前3位”；行业标准（QB/T 等）起草单位未公开时明细显示“暂无公开起草单位数据”。

## 11. 待办

1. 将 `crawlSamrStandards` 接入 `Policyanalysize`（vite 中间件新增 `/api/crawl/samr`，或独立服务）；
2. 建企业集团映射表：海信容声（广东）冰箱、海信冰箱、海信空调、海信家电 → 海信系；合肥美的 → 美的；青岛海尔/海尔智家 → 海尔；珠海格力 → 格力；长虹美菱/合肥华凌 → 美菱；
3. 建起草单位注册地知识库（用于省份地图）；
4. 把 `extractStandardWithLlm` 的 LLM 提取并入正式服务（可人工覆盖，复用 `policy-classifier.mjs` 的配置与重试模式）；
5. 落库与调度：SQLite 主键去重 + 每日增量；二期逆向 std.miit.gov.cn POST 契约。

## 12. 风险与边界

- 行业标准起草单位公开程度不一：SAMR 部分记录无、hbba 部分记录为空，统计时须标注“起草单位未公开”，LLM 也不得臆造；
- 接口为政府公开数据，需保持低频、标识 UA、尊重访问策略（对应赛题“依据海信对外部网站访问策略”）；
- 详情页结构可能改版：显式键值解析按“标签 + 值容器”结构实现，建议生产环境用 DOM 解析器并保留解析失败降级；散文部分一律交给 LLM，不写启发式正则；
- 计划与已发布标准存在重复（同一项目两条记录），统计前必须做计划↔标准合并，避免重复计数。
