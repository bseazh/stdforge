import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const markdown = `# 政策专家解读报告

## 一、政策背景

**重点结论：** 政策与冰箱行业直接相关。

- 行业影响
- 行动建议

> 具体要求以官方原文为准。

| 产品 | 影响程度 |
|---|---|
| 冰箱 | 高 |
`

const html = renderToStaticMarkup(React.createElement(ReactMarkdown, {
  remarkPlugins: [remarkGfm],
  children: markdown,
}))

if (!html.includes('<h1>政策专家解读报告</h1>')) throw new Error('一级标题未渲染')
if (!html.includes('<h2>一、政策背景</h2>')) throw new Error('二级标题未渲染')
if (!html.includes('<strong>重点结论：</strong>')) throw new Error('加粗内容未渲染')
if (!html.includes('<ul>')) throw new Error('列表未渲染')
if (!html.includes('<blockquote>')) throw new Error('引用未渲染')
if (!html.includes('<table>')) throw new Error('GFM 表格未渲染')
if (html.includes('# 政策专家解读报告')) throw new Error('页面仍显示 Markdown 标题源码')

console.log(JSON.stringify({
  headingRendered: html.includes('<h1>'),
  boldRendered: html.includes('<strong>'),
  listRendered: html.includes('<ul>'),
  quoteRendered: html.includes('<blockquote>'),
  tableRendered: html.includes('<table>'),
  rawHeadingHidden: !html.includes('# 政策专家解读报告'),
}, null, 2))
