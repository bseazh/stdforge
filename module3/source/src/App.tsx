import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BellRing,
  AlertCircle,
  BookOpenText,
  CalendarDays,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Clock3,
  FileSearch,
  Download,
  ExternalLink,
  FolderTree,
  Globe2,
  Info,
  Link2,
  ListChecks,
  MapPin,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  Users,
  X,
} from 'lucide-react'

type UpdateMode = '实时更新' | '每周更新'
type PolicyInterpretationSkill = 'policy-expert-interpretation' | 'policy-clause-analysis'
type InterpretationStatus = 'idle' | 'running' | 'completed' | 'error'
type ScheduleFrequency = '每天' | '每周' | '每月'
type DateRangePreset = '最近7天' | '最近30天' | '最近1年' | '自定义'
type TaskView = 'collect' | 'classify' | 'interpret' | 'deliver'
type RecipientGroup = '标准化工程师' | '政策研究人员' | '业务负责人'
type RecipientGroupFilter = '全部分组' | RecipientGroup
type Recipient = {
  id: string
  name: string
  email: string
  group: RecipientGroup
}
type RecipientDraft = Omit<Recipient, 'id'>
type DeliveryReportPackage = {
  policy: CrawledPolicy
  skillId: PolicyInterpretationSkill
  reportType: string
  analysisAudience: string
  administrativeLevel: string
  policyCategory: string
  report: string
  generatedAt: string
}
type DeliveryStatus = 'idle' | 'sending' | 'sent' | 'error'
type NotificationOperation =
  | { kind: 'send' }
  | { kind: 'save'; recipientId: string | null; draft: RecipientDraft; previousEmail?: string }
  | { kind: 'delete'; recipient: Recipient }
type NotificationSessionResponse = {
  authorized: boolean
  smtpConfigured: boolean
  smtpVerified: boolean
  smtpVerificationState: string
  notificationRecipientCount: number
}
type NotificationSendResponse = {
  deliveries: Array<{ recipient: string; messageId: string }>
  sentAt: string
  attachmentFilename: string
}
type NotificationRecipientsResponse = {
  recipients: string[]
  maxRecipients: number
}
type LogLevel = '信息' | '成功' | '警告' | '错误'
type LogEntry = {
  id: string
  time: string
  level: LogLevel
  stage: string
  message: string
}
type WebsiteSource = {
  id: string
  name: string
  url: string
  official: boolean
}
type RegionOption = {
  id: string
  name: string
  description: string
  removable: boolean
}
type CrawledPolicy = {
  id: string
  title: string
  url: string
  publishedAt: string
  documentNumber: string
  publisher: string
  documentType: string
  theme: string
  source: string
  sourceDomain: string
  content: string
  contentPreview: string
  attachments: Array<{ name: string; url: string }>
}
type PolicyPreprocessing = {
  policyId: string
  title: {
    originalTitle: string
    issuingAuthority: string
    issuingLocation: string
    documentName: string
    documentNumber: string
    documentType: string
  }
  content: {
    summary: string
    keyPoints: string[]
    topics: string[]
    sourceCharacterCount: number
    publishedAt: string
    sourceUrl: string
  }
}
type ModelClassification = {
  administrativeLevel: string
  policyCategory: string
  confidence: number
  reasoning: string
  evidence: string[]
}
type PolicyAnalysis = {
  status: 'queued' | 'analyzing' | 'completed' | 'model_unconfigured' | 'error'
  preprocessing?: PolicyPreprocessing
  classification?: ModelClassification | null
  error?: string
}
type ClassificationDraft = {
  administrativeLevel: string
  policyCategory: string
  manuallyAdjusted: boolean
}
type ClassificationResponse = {
  configured: boolean
  model: string | null
  results: Array<{
    policyId: string
    status: 'completed' | 'model_unconfigured' | 'error'
    preprocessing: PolicyPreprocessing
    classification: ModelClassification | null
    error?: string
  }>
}
type InterpretationResponse = {
  policyId: string
  skillId: PolicyInterpretationSkill
  audience: string
  model: string
  report: string
  generatedAt: string
}
type CrawlResponse = {
  policies: CrawledPolicy[]
  logs: Array<{ level: LogLevel; stage: string; message: string }>
  keywordStats: Array<{ keyword: string; totalHits: number; fetched: number }>
  source: { name: string; domain: string; entryUrl: string; categoryId: string }
}

const keywordSuggestions = ['冰箱', '白色家电', '制冷', '能效']
const audiences: RecipientGroup[] = ['标准化工程师', '政策研究人员', '业务负责人']
const initialRecipients: Recipient[] = [
  { id: 'recipient-1', name: '王敏', email: 'wang.min@example.com', group: '标准化工程师' },
  { id: 'recipient-2', name: '李晨', email: 'li.chen@example.com', group: '标准化工程师' },
  { id: 'recipient-3', name: '陈曦', email: 'chen.xi@example.com', group: '政策研究人员' },
  { id: 'recipient-4', name: '赵宁', email: 'zhao.ning@example.com', group: '政策研究人员' },
]
const weekDays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const administrativeLevelOptions = ['国家级', '省级', '市级', '区县级', '其他']
const policyCategoryOptions = ['通用政策', '产业政策']
const initialWebsites: WebsiteSource[] = [
  {
    id: 'miit',
    name: '工业和信息化部政策文件库',
    url: 'https://www.miit.gov.cn/search/zcwjk.html?websiteid=110000000000000&pg=&p=&tpl=14&category=183&q=',
    official: true,
  },
  { id: 'samr', name: '国家市场监督管理总局', url: 'https://www.samr.gov.cn', official: true },
  { id: 'ndrc', name: '国家发展和改革委员会', url: 'https://www.ndrc.gov.cn', official: true },
  { id: 'gov-gd', name: '广东省人民政府', url: 'https://www.gd.gov.cn', official: true },
]
const initialRegions: RegionOption[] = [
  { id: 'national', name: '国家级', description: '国务院及中央部委发布的全国性政策', removable: false },
  { id: 'guangdong', name: '广东省', description: '广东省及辖区相关地方政策', removable: false },
]

const getLogTime = () => new Date().toLocaleTimeString('zh-CN', {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})
const logLevelClass: Record<LogLevel, string> = {
  信息: 'info',
  成功: 'success',
  警告: 'warning',
  错误: 'error',
}

const CRAWL_RESULTS_PER_PAGE = 10

const toDateInputValue = (date: Date) => {
  const timezoneOffset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

const getPresetStartDate = (preset: Exclude<DateRangePreset, '自定义'>) => {
  const start = new Date()
  if (preset === '最近7天') start.setDate(start.getDate() - 6)
  if (preset === '最近30天') start.setDate(start.getDate() - 29)
  if (preset === '最近1年') start.setFullYear(start.getFullYear() - 1)
  return toDateInputValue(start)
}

const formatDateLabel = (value: string) => {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : '未设置'
}

const cleanSummaryText = (value = '') => value
  .replace(/^[\s，,。；;：:、…·-]+/, '')
  .replace(/(?:\.{3,}|…{2,})\s*$/, '')
  .replace(/\s+/g, ' ')
  .trim()

const createMarkdownFilename = (title: string, skillId: PolicyInterpretationSkill) => {
  const suffix = skillId === 'policy-expert-interpretation' ? '专家解读' : '条款拆解'
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${safeTitle || '政策分析'}-${suffix}.md`
}

function App() {
  const [activeTask, setActiveTask] = useState<TaskView>('collect')
  const [keywords, setKeywords] = useState('冰箱、白色家电')
  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>('最近30天')
  const [startDate, setStartDate] = useState(getPresetStartDate('最近30天'))
  const [endDate, setEndDate] = useState(toDateInputValue(new Date()))
  const [websites, setWebsites] = useState<WebsiteSource[]>(initialWebsites)
  const [selectedWebsiteIds, setSelectedWebsiteIds] = useState(['miit'])
  const [isWebsiteOpen, setIsWebsiteOpen] = useState(false)
  const [isAddingWebsite, setIsAddingWebsite] = useState(false)
  const [newWebsiteName, setNewWebsiteName] = useState('')
  const [newWebsiteUrl, setNewWebsiteUrl] = useState('')
  const [websiteError, setWebsiteError] = useState('')
  const [updateMode, setUpdateMode] = useState<UpdateMode>('每周更新')
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>('每周')
  const [selectedWeekDays, setSelectedWeekDays] = useState(['周一'])
  const [monthlyDay, setMonthlyDay] = useState('1')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [savedSchedule, setSavedSchedule] = useState('每周一 09:00')
  const [regions, setRegions] = useState<RegionOption[]>(initialRegions)
  const [selectedRegionIds, setSelectedRegionIds] = useState(['national'])
  const [isRegionOpen, setIsRegionOpen] = useState(false)
  const [isAddingRegion, setIsAddingRegion] = useState(false)
  const [newRegionName, setNewRegionName] = useState('')
  const [regionError, setRegionError] = useState('')
  const [policyType, setPolicyType] = useState('产业专用政策')
  const [interpretationSkill, setInterpretationSkill] = useState<PolicyInterpretationSkill>('policy-expert-interpretation')
  const [interpreter, setInterpreter] = useState('标准化管理组')
  const [customInterpreter, setCustomInterpreter] = useState('')
  const [interpretationPolicy, setInterpretationPolicy] = useState<CrawledPolicy | null>(null)
  const [interpretationStatus, setInterpretationStatus] = useState<InterpretationStatus>('idle')
  const [interpretationReport, setInterpretationReport] = useState('')
  const [interpretationReportAudience, setInterpretationReportAudience] = useState('')
  const [interpretationReportSkill, setInterpretationReportSkill] = useState<PolicyInterpretationSkill | null>(null)
  const [interpretationGeneratedAt, setInterpretationGeneratedAt] = useState('')
  const [interpretationError, setInterpretationError] = useState('')
  const [reportActionMessage, setReportActionMessage] = useState('')
  const [deliveryReport, setDeliveryReport] = useState<DeliveryReportPackage | null>(null)
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('idle')
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const [notificationAuthorized, setNotificationAuthorized] = useState(false)
  const [notificationConfigured, setNotificationConfigured] = useState(false)
  const [notificationVerified, setNotificationVerified] = useState(false)
  const [notificationAuthOpen, setNotificationAuthOpen] = useState(false)
  const [notificationAccessToken, setNotificationAccessToken] = useState('')
  const [notificationAuthError, setNotificationAuthError] = useState('')
  const [notificationAuthRunning, setNotificationAuthRunning] = useState(false)
  const [pendingNotificationOperation, setPendingNotificationOperation] = useState<NotificationOperation | null>(null)
  const [selectedAudiences, setSelectedAudiences] = useState<RecipientGroup[]>(['业务负责人'])
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients)
  const [recipientGroupFilter, setRecipientGroupFilter] = useState<RecipientGroupFilter>('全部分组')
  const [recipientSearch, setRecipientSearch] = useState('')
  const [isRecipientEditorOpen, setIsRecipientEditorOpen] = useState(false)
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null)
  const [recipientDraft, setRecipientDraft] = useState<RecipientDraft>({
    name: '',
    email: '',
    group: '标准化工程师',
  })
  const [recipientError, setRecipientError] = useState('')
  const [running, setRunning] = useState(false)
  const [statusText, setStatusText] = useState('等待开始…')
  const [progress, setProgress] = useState(0)
  const [crawlAttempted, setCrawlAttempted] = useState(false)
  const [crawledPolicies, setCrawledPolicies] = useState<CrawledPolicy[]>([])
  const [crawlResultPage, setCrawlResultPage] = useState(1)
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<string[]>([])
  const [confirmedPolicies, setConfirmedPolicies] = useState<CrawledPolicy[]>([])
  const [policyAnalyses, setPolicyAnalyses] = useState<Record<string, PolicyAnalysis>>({})
  const [classificationDrafts, setClassificationDrafts] = useState<Record<string, ClassificationDraft>>({})
  const [classificationLevelFilter, setClassificationLevelFilter] = useState('全部层级')
  const [classificationCategoryFilter, setClassificationCategoryFilter] = useState('全部类型')
  const [expandedAnalysisPolicyId, setExpandedAnalysisPolicyId] = useState<string | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 'ready', time: getLogTime(), level: '信息', stage: '系统', message: '页面已就绪，等待开始处理' },
  ])
  const websitePickerRef = useRef<HTMLDivElement>(null)
  const regionPickerRef = useRef<HTMLDivElement>(null)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const crawlAbortRef = useRef<AbortController | null>(null)
  const classificationAbortRef = useRef<AbortController | null>(null)
  const interpretationAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (websitePickerRef.current && !websitePickerRef.current.contains(event.target as Node)) {
        setIsWebsiteOpen(false)
        setIsAddingWebsite(false)
        setWebsiteError('')
      }
      if (regionPickerRef.current && !regionPickerRef.current.contains(event.target as Node)) {
        setIsRegionOpen(false)
        setIsAddingRegion(false)
        setRegionError('')
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsWebsiteOpen(false)
        setIsAddingWebsite(false)
        setWebsiteError('')
        setIsRegionOpen(false)
        setIsAddingRegion(false)
        setRegionError('')
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/notifications/session', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取邮件服务状态')
        return response.json() as Promise<NotificationSessionResponse>
      })
      .then((data) => {
        setNotificationAuthorized(data.authorized)
        setNotificationConfigured(data.smtpConfigured)
        setNotificationVerified(data.smtpVerified)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setNotificationConfigured(false)
        setNotificationVerified(false)
      })
    fetch('/api/notifications/recipients', { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取测试收件人')
        return response.json() as Promise<NotificationRecipientsResponse>
      })
      .then((data) => {
        setRecipients((current) => [
          ...current.filter((recipient) => recipient.group !== '业务负责人'),
          ...data.recipients.map((email, index) => ({
            id: `server-recipient-${index + 1}`,
            name: index === 0 ? '阿丽塔' : `业务联系人 ${index + 1}`,
            email,
            group: '业务负责人' as RecipientGroup,
          })),
        ])
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const appendLog = (level: LogLevel, stage: string, message: string) => {
    setLogs((current) => [...current, {
      id: `${Date.now()}-${Math.random()}`,
      time: getLogTime(),
      level,
      stage,
      message,
    }])
  }

  const selectedWebsites = websites.filter((website) => selectedWebsiteIds.includes(website.id))
  const selectedRegions = regions.filter((region) => selectedRegionIds.includes(region.id))
  const selectedPolicies = crawledPolicies.filter((policy) => selectedPolicyIds.includes(policy.id))
  const crawlResultPageCount = Math.max(1, Math.ceil(crawledPolicies.length / CRAWL_RESULTS_PER_PAGE))
  const paginatedCrawledPolicies = crawledPolicies.slice(
    (crawlResultPage - 1) * CRAWL_RESULTS_PER_PAGE,
    crawlResultPage * CRAWL_RESULTS_PER_PAGE,
  )
  const completedClassificationCount = confirmedPolicies.filter((policy) =>
    policyAnalyses[policy.id]?.status === 'completed',
  ).length
  const classificationProcessingCount = confirmedPolicies.filter((policy) =>
    ['queued', 'analyzing'].includes(policyAnalyses[policy.id]?.status),
  ).length
  const modelUnconfiguredCount = confirmedPolicies.filter((policy) =>
    policyAnalyses[policy.id]?.status === 'model_unconfigured',
  ).length
  const filteredConfirmedPolicies = confirmedPolicies.filter((policy) => {
    const analysis = policyAnalyses[policy.id]
    const draft = classificationDrafts[policy.id]
    const level = draft?.administrativeLevel || analysis?.classification?.administrativeLevel || ''
    const category = draft?.policyCategory || analysis?.classification?.policyCategory || ''
    return (classificationLevelFilter === '全部层级' || level === classificationLevelFilter)
      && (classificationCategoryFilter === '全部类型' || category === classificationCategoryFilter)
  })
  const interpretationPolicyAnalysis = interpretationPolicy
    ? policyAnalyses[interpretationPolicy.id]
    : undefined
  const interpretationPolicySummary = cleanSummaryText(
    interpretationPolicyAnalysis?.preprocessing?.content.summary
      || interpretationPolicy?.contentPreview
      || '',
  )
  const selectedAnalysisAudience = interpreter === '其他' ? customInterpreter.trim() : interpreter
  const dateRangeLabel = `${formatDateLabel(startDate)} 至 ${formatDateLabel(endDate)}`

  const applyDatePreset = (preset: Exclude<DateRangePreset, '自定义'>) => {
    setDateRangePreset(preset)
    setStartDate(getPresetStartDate(preset))
    setEndDate(toDateInputValue(new Date()))
  }

  const toggleWebsite = (websiteId: string) => {
    setSelectedWebsiteIds((current) => current.includes(websiteId)
      ? current.filter((id) => id !== websiteId)
      : [...current, websiteId])
  }

  const removeWebsite = (websiteId: string) => {
    setWebsites((current) => current.filter((website) => website.id !== websiteId))
    setSelectedWebsiteIds((current) => current.filter((id) => id !== websiteId))
  }

  const toggleRegion = (regionId: string) => {
    setSelectedRegionIds((current) => {
      if (current.includes(regionId)) {
        return current.length === 1 ? current : current.filter((id) => id !== regionId)
      }
      return [...current, regionId]
    })
  }

  const removeRegion = (regionId: string) => {
    const region = regions.find((item) => item.id === regionId)
    if (!region?.removable) return

    setRegions((current) => current.filter((item) => item.id !== regionId))
    setSelectedRegionIds((current) => {
      const next = current.filter((id) => id !== regionId)
      return next.length > 0 ? next : ['national']
    })
  }

  const handleAddRegion = () => {
    const name = newRegionName.trim()
    if (!name) {
      setRegionError('请输入地区名称')
      return
    }
    if (regions.some((region) => region.name === name)) {
      setRegionError('这个地区已经在列表中')
      return
    }

    const region: RegionOption = {
      id: `custom-region-${Date.now()}`,
      name,
      description: '用户自定义关注地区',
      removable: true,
    }
    setRegions((current) => [...current, region])
    setSelectedRegionIds((current) => [...current, region.id])
    setNewRegionName('')
    setRegionError('')
    setIsAddingRegion(false)
  }

  const handleAddWebsite = () => {
    const name = newWebsiteName.trim()
    const rawUrl = newWebsiteUrl.trim()
    if (!name || !rawUrl) {
      setWebsiteError('请填写网站名称和网站链接')
      return
    }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    try {
      new URL(normalizedUrl)
    } catch {
      setWebsiteError('请输入正确的网站链接，例如 https://example.com')
      return
    }

    const website: WebsiteSource = {
      id: `custom-${Date.now()}`,
      name,
      url: normalizedUrl,
      official: false,
    }
    setWebsites((current) => [...current, website])
    setSelectedWebsiteIds((current) => [...current, website.id])
    setNewWebsiteName('')
    setNewWebsiteUrl('')
    setWebsiteError('')
    setIsAddingWebsite(false)
  }

  const toggleAudience = (audience: RecipientGroup) => {
    setSelectedAudiences((current) => current.includes(audience)
      ? current.filter((item) => item !== audience)
      : [...current, audience])
    setDeliveryStatus('idle')
    setDeliveryMessage('')
  }

  const openNewRecipientEditor = () => {
    setEditingRecipientId(null)
    setRecipientDraft({
      name: '',
      email: '',
      group: recipientGroupFilter === '全部分组' ? '标准化工程师' : recipientGroupFilter,
    })
    setRecipientError('')
    setIsRecipientEditorOpen(true)
  }

  const openRecipientEditor = (recipient: Recipient) => {
    setEditingRecipientId(recipient.id)
    setRecipientDraft({ name: recipient.name, email: recipient.email, group: recipient.group })
    setRecipientError('')
    setIsRecipientEditorOpen(true)
  }

  const closeRecipientEditor = () => {
    setIsRecipientEditorOpen(false)
    setEditingRecipientId(null)
    setRecipientError('')
  }

  const callNotificationApi = async <T,>(path: string, method: string, body?: unknown) => {
    const response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await response.json() as T & { error?: string; code?: string }
    if (!response.ok) {
      const error = new Error(data.error || `邮件接口返回 HTTP ${response.status}`) as Error & { status?: number }
      error.status = response.status
      throw error
    }
    return data
  }

  const performNotificationOperation = async (operation: NotificationOperation) => {
    try {
      if (operation.kind === 'save') {
        if (operation.previousEmail && operation.previousEmail !== operation.draft.email) {
          await callNotificationApi('/api/notifications/recipients', 'DELETE', { email: operation.previousEmail })
        }
        await callNotificationApi('/api/notifications/recipients', 'POST', { email: operation.draft.email })
        if (operation.recipientId) {
          setRecipients((current) => current.map((recipient) => recipient.id === operation.recipientId
            ? { ...recipient, ...operation.draft }
            : recipient))
        } else {
          setRecipients((current) => [...current, {
            id: `recipient-${Date.now()}`,
            ...operation.draft,
          }])
        }
        setDeliveryStatus('idle')
        setDeliveryMessage('联系人已保存，并同步加入服务端测试收件人白名单。')
        closeRecipientEditor()
        return
      }

      if (operation.kind === 'delete') {
        await callNotificationApi('/api/notifications/recipients', 'DELETE', { email: operation.recipient.email })
        setRecipients((current) => current.filter((recipient) => recipient.id !== operation.recipient.id))
        setDeliveryStatus('idle')
        setDeliveryMessage('联系人已删除，并从服务端测试收件人白名单移除。')
        if (editingRecipientId === operation.recipient.id) closeRecipientEditor()
        return
      }

      if (!deliveryReport) return
      const recipientsForDelivery = recipients.filter((recipient) => selectedAudiences.includes(recipient.group))
      setDeliveryStatus('sending')
      setDeliveryMessage(`正在通过 SMTP 向 ${recipientsForDelivery.length} 位联系人投递报告…`)
      const result = await callNotificationApi<NotificationSendResponse>('/api/notifications/send', 'POST', {
        recipients: recipientsForDelivery.map((recipient) => recipient.email),
        policyTitle: deliveryReport.policy.title,
        policyUrl: deliveryReport.policy.url,
        reportType: deliveryReport.reportType,
        analysisAudience: deliveryReport.analysisAudience,
        administrativeLevel: deliveryReport.administrativeLevel,
        policyCategory: deliveryReport.policyCategory,
        report: deliveryReport.report,
      })
      setDeliveryStatus('sent')
      setDeliveryMessage(`SMTP 服务器已接受 ${result.deliveries.length} 封邮件，完整报告附件为“${result.attachmentFilename}”。`)
    } catch (error) {
      const requestError = error as Error & { status?: number }
      if (requestError.status === 401) {
        setNotificationAuthorized(false)
        setPendingNotificationOperation(operation)
        setNotificationAuthError('当前管理会话已失效，请重新输入管理验证码。')
        setNotificationAuthOpen(true)
        setDeliveryStatus('idle')
        return
      }
      if (operation.kind === 'save') setRecipientError(requestError.message)
      else {
        setDeliveryStatus('error')
        setDeliveryMessage(requestError.message)
      }
    }
  }

  const requestNotificationOperation = (operation: NotificationOperation) => {
    if (notificationAuthorized) {
      void performNotificationOperation(operation)
      return
    }
    setPendingNotificationOperation(operation)
    setNotificationAccessToken('')
    setNotificationAuthError('')
    setNotificationAuthOpen(true)
  }

  const saveRecipient = () => {
    const name = recipientDraft.name.trim()
    const email = recipientDraft.email.trim()
    if (!name) {
      setRecipientError('请输入联系人姓名')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRecipientError('请输入正确的邮箱地址')
      return
    }

    const previousRecipient = recipients.find((recipient) => recipient.id === editingRecipientId)
    requestNotificationOperation({
      kind: 'save',
      recipientId: editingRecipientId,
      draft: { name, email, group: recipientDraft.group },
      previousEmail: previousRecipient?.email,
    })
  }

  const removeRecipient = (recipientId: string) => {
    const recipient = recipients.find((item) => item.id === recipientId)
    if (recipient) requestNotificationOperation({ kind: 'delete', recipient })
  }

  const togglePolicySelection = (policyId: string) => {
    setSelectedPolicyIds((current) => current.includes(policyId)
      ? current.filter((id) => id !== policyId)
      : [...current, policyId])
  }

  const toggleAllPolicies = () => {
    setSelectedPolicyIds((current) => current.length === crawledPolicies.length
      ? []
      : crawledPolicies.map((policy) => policy.id))
  }

  const analyzePoliciesAutomatically = async (policies: CrawledPolicy[]) => {
    if (policies.length === 0) return
    classificationAbortRef.current?.abort()
    const controller = new AbortController()
    classificationAbortRef.current = controller
    setPolicyAnalyses((current) => {
      const next = { ...current }
      policies.forEach((policy) => {
        next[policy.id] = { ...next[policy.id], status: 'analyzing', error: undefined }
      })
      return next
    })
    try {
      const response = await fetch('/api/classify/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policies }),
        signal: controller.signal,
      })
      const data = await response.json() as ClassificationResponse & { error?: string }
      if (!response.ok) throw new Error(data.error || `分类接口返回 HTTP ${response.status}`)
      setPolicyAnalyses((current) => {
        const next = { ...current }
        data.results.forEach((result) => {
          next[result.policyId] = {
            status: result.status,
            preprocessing: result.preprocessing,
            classification: result.classification,
            error: result.error,
          }
        })
        return next
      })
      setClassificationDrafts((current) => {
        const next = { ...current }
        data.results.forEach((result) => {
          if (next[result.policyId]?.manuallyAdjusted) return
          next[result.policyId] = {
            administrativeLevel: result.classification?.administrativeLevel || '',
            policyCategory: result.classification?.policyCategory || '',
            manuallyAdjusted: false,
          }
        })
        return next
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '自动分类失败'
      setPolicyAnalyses((current) => {
        const next = { ...current }
        policies.forEach((policy) => {
          next[policy.id] = { ...next[policy.id], status: 'error', error: message }
        })
        return next
      })
    } finally {
      if (classificationAbortRef.current === controller) classificationAbortRef.current = null
    }
  }

  const confirmPoliciesForClassification = () => {
    if (selectedPolicies.length === 0) return
    setConfirmedPolicies((current) => {
      const merged = new Map(current.map((policy) => [policy.id, policy]))
      selectedPolicies.forEach((policy) => merged.set(policy.id, policy))
      return [...merged.values()]
    })
    setPolicyAnalyses((current) => {
      const next = { ...current }
      selectedPolicies.forEach((policy) => {
        next[policy.id] = { status: 'queued' }
      })
      return next
    })
    setActiveTask('classify')
    void analyzePoliciesAutomatically(selectedPolicies)
  }

  const applyClassificationOverride = (
    policyId: string,
    field: 'administrativeLevel' | 'policyCategory',
    value: string,
  ) => {
    const analysis = policyAnalyses[policyId]
    setClassificationDrafts((current) => ({
      ...current,
      [policyId]: {
        administrativeLevel: current[policyId]?.administrativeLevel
          || analysis?.classification?.administrativeLevel
          || '',
        policyCategory: current[policyId]?.policyCategory
          || analysis?.classification?.policyCategory
          || '',
        manuallyAdjusted: true,
        [field]: value,
      },
    }))
  }

  const openPolicyInterpretation = (policy: CrawledPolicy) => {
    interpretationAbortRef.current?.abort()
    interpretationAbortRef.current = null
    setInterpretationPolicy(policy)
    setInterpretationStatus('idle')
    setInterpretationReport('')
    setInterpretationReportAudience('')
    setInterpretationReportSkill(null)
    setInterpretationGeneratedAt('')
    setInterpretationError('')
    setReportActionMessage('')
    setActiveTask('interpret')
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const runPolicyInterpretation = async () => {
    if (!interpretationPolicy || !selectedAnalysisAudience || interpretationStatus === 'running') return
    interpretationAbortRef.current?.abort()
    const controller = new AbortController()
    interpretationAbortRef.current = controller
    setInterpretationStatus('running')
    setInterpretationReport('')
    setInterpretationReportAudience('')
    setInterpretationReportSkill(null)
    setInterpretationGeneratedAt('')
    setInterpretationError('')
    setReportActionMessage('')
    try {
      const response = await fetch('/api/interpret/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          policy: interpretationPolicy,
          skillId: interpretationSkill,
          audience: selectedAnalysisAudience,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as InterpretationResponse & { error?: string }
      if (!response.ok) throw new Error(data.error || `政策分析接口返回 HTTP ${response.status}`)
      setInterpretationReport(data.report)
      setInterpretationReportAudience(data.audience)
      setInterpretationReportSkill(data.skillId)
      setInterpretationGeneratedAt(data.generatedAt)
      setInterpretationStatus('completed')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setInterpretationStatus('error')
      setInterpretationError(error instanceof Error ? error.message : '政策分析失败')
    } finally {
      if (interpretationAbortRef.current === controller) interpretationAbortRef.current = null
    }
  }

  const copyInterpretationReport = async () => {
    if (!interpretationReport) return
    try {
      await navigator.clipboard.writeText(interpretationReport)
      setReportActionMessage('已复制 Markdown 原文')
    } catch {
      setReportActionMessage('复制失败，请手动选择报告内容复制')
    }
  }

  const saveInterpretationReport = async () => {
    if (!interpretationReport || !interpretationPolicy) return
    const suggestedName = createMarkdownFilename(interpretationPolicy.title, interpretationReportSkill || interpretationSkill)
    try {
      const saveFilePicker = (window as unknown as {
        showSaveFilePicker?: (options: unknown) => Promise<{
          createWritable: () => Promise<{
            write: (content: string) => Promise<void>
            close: () => Promise<void>
          }>
        }>
      }).showSaveFilePicker
      if (saveFilePicker) {
        const handle = await saveFilePicker({
          suggestedName,
          types: [{ description: 'Markdown 文件', accept: { 'text/markdown': ['.md'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(interpretationReport)
        await writable.close()
        setReportActionMessage('Markdown 报告已保存')
        return
      }

      const url = URL.createObjectURL(new Blob([interpretationReport], { type: 'text/markdown;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = suggestedName
      anchor.click()
      URL.revokeObjectURL(url)
      setReportActionMessage('浏览器已开始下载 Markdown 报告')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setReportActionMessage(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
    }
  }

  const openReportDelivery = () => {
    if (!interpretationPolicy || !interpretationReport || interpretationStatus !== 'completed') return
    const finalClassification = classificationDrafts[interpretationPolicy.id]
    const modelClassification = policyAnalyses[interpretationPolicy.id]?.classification
    setDeliveryReport({
      policy: interpretationPolicy,
      skillId: interpretationReportSkill || interpretationSkill,
      reportType: (interpretationReportSkill || interpretationSkill) === 'policy-expert-interpretation' ? '专家解读报告' : '条款拆解报告',
      analysisAudience: interpretationReportAudience || selectedAnalysisAudience,
      administrativeLevel: finalClassification?.administrativeLevel || modelClassification?.administrativeLevel || '待确认',
      policyCategory: finalClassification?.policyCategory || modelClassification?.policyCategory || '待确认',
      report: interpretationReport,
      generatedAt: interpretationGeneratedAt || new Date().toISOString(),
    })
    setDeliveryStatus('idle')
    setDeliveryMessage('')
    setActiveTask('deliver')
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const checkReportDelivery = () => {
    if (!deliveryReport) {
      setDeliveryStatus('error')
      setDeliveryMessage('请先从任务 3 选择一份已经生成的分析报告。')
      return
    }
    if (selectedAudiences.length === 0) {
      setDeliveryStatus('error')
      setDeliveryMessage('请至少选择一个推送分组。')
      return
    }
    const recipientsForDelivery = recipients.filter((recipient) => selectedAudiences.includes(recipient.group))
    if (recipientsForDelivery.length === 0) {
      setDeliveryStatus('error')
      setDeliveryMessage('所选分组中没有联系人，请先在通讯录中添加姓名和邮箱。')
      return
    }
    if (!notificationConfigured) {
      setDeliveryStatus('error')
      setDeliveryMessage('SMTP 服务尚未配置或服务未按安全配置重启。')
      return
    }
    requestNotificationOperation({ kind: 'send' })
  }

  const submitNotificationAuthorization = async () => {
    if (!notificationAccessToken.trim() || notificationAuthRunning) return
    setNotificationAuthRunning(true)
    setNotificationAuthError('')
    try {
      await callNotificationApi<{ authorized: boolean }>('/api/notifications/auth', 'POST', {
        accessToken: notificationAccessToken,
      })
      const operation = pendingNotificationOperation
      setNotificationAuthorized(true)
      setNotificationAuthOpen(false)
      setNotificationAccessToken('')
      setPendingNotificationOperation(null)
      if (operation) await performNotificationOperation(operation)
    } catch (error) {
      setNotificationAuthError(error instanceof Error ? error.message : '管理验证码校验失败')
    } finally {
      setNotificationAuthRunning(false)
    }
  }

  const toggleWeekDay = (day: string) => {
    setSelectedWeekDays((current) => {
      if (current.includes(day)) {
        return current.length === 1 ? current : current.filter((item) => item !== day)
      }
      return [...current, day].sort((a, b) => weekDays.indexOf(a) - weekDays.indexOf(b))
    })
  }

  const formatSchedule = () => {
    if (scheduleFrequency === '每天') return `每天 ${scheduleTime}`
    if (scheduleFrequency === '每月') return `每月 ${monthlyDay} 日 ${scheduleTime}`
    return `每${selectedWeekDays.join('、')} ${scheduleTime}`
  }

  const saveSchedule = () => {
    setSavedSchedule(formatSchedule())
    setIsScheduleOpen(false)
    setStatusText(`定时任务已配置为：${formatSchedule()}（UI 演示）`)
  }

  const handleStart = async () => {
    if (!keywords.trim()) {
      setStatusText('请先填写需要检索的关键词')
      setProgress(0)
      appendLog('错误', '配置校验', '关注关键词为空，处理未启动')
      return
    }
    if (selectedWebsiteIds.length === 0) {
      setStatusText('请至少选择一个主要网站')
      setProgress(0)
      appendLog('错误', '配置校验', '没有选中政策来源网站，处理未启动')
      return
    }
    if (!startDate || !endDate) {
      setStatusText('请完整填写政策发布日期范围')
      setProgress(0)
      appendLog('错误', '配置校验', '政策发布日期范围不完整，处理未启动')
      return
    }
    if (startDate > endDate) {
      setStatusText('政策发布日期的开始日期不能晚于结束日期')
      setProgress(0)
      appendLog('错误', '配置校验', '政策发布日期范围无效：开始日期晚于结束日期')
      return
    }
    if (!selectedWebsiteIds.includes('miit')) {
      setStatusText('当前真实采集仅支持工信部政策文件库')
      setProgress(0)
      appendLog('错误', '来源适配', '选中的网站尚未接入采集适配器，请先选择工信部政策文件库')
      return
    }

    const queryKeywords = keywords.split(/[、，,\n]+/).map((keyword) => keyword.trim()).filter(Boolean)
    const unsupportedSources = selectedWebsites.filter((website) => website.id !== 'miit')
    const executionLabel = updateMode === '实时更新' ? '实时检查' : '手动检查'
    const controller = new AbortController()
    crawlAbortRef.current = controller
    setRunning(true)
    setCrawlAttempted(true)
    setCrawledPolicies([])
    setCrawlResultPage(1)
    setSelectedPolicyIds([])
    setProgress(18)
    setStatusText(`${executionLabel}：正在连接工信部政策文件库，检索 ${dateRangeLabel} 发布的政策`)
    setLogs((current) => [...current,
      { id: `${Date.now()}-config`, time: getLogTime(), level: '成功', stage: '配置校验', message: '关键词、发布日期和政策来源校验通过' },
      {
        id: `${Date.now()}-mode`,
        time: getLogTime(),
        level: '信息',
        stage: updateMode,
        message: updateMode === '实时更新'
          ? '已触发即时真实检查，本轮直接访问工信部政策文件库'
          : `已按“${savedSchedule}”配置执行一次手动验证；后台定时任务尚未启用`,
      },
      { id: `${Date.now()}-source`, time: getLogTime(), level: '信息', stage: '政策收集', message: `开始从工信部官方政策文件库检索 ${dateRangeLabel} 发布的“${queryKeywords.join('、')}”` },
      ...(unsupportedSources.length > 0 ? [{
        id: `${Date.now()}-unsupported`,
        time: getLogTime(),
        level: '警告' as LogLevel,
        stage: '来源适配',
        message: `${unsupportedSources.map((website) => website.name).join('、')} 尚未接入，本次不会访问`,
      }] : []),
    ])

    try {
      setProgress(32)
      const response = await fetch('/api/crawl/miit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: queryKeywords,
          startDate,
          endDate,
          maxPages: 3,
          pageSize: 10,
        }),
        signal: controller.signal,
      })
      const data = await response.json() as CrawlResponse & { error?: string }
      if (!response.ok) throw new Error(data.error || `采集接口返回 HTTP ${response.status}`)

      setCrawledPolicies(data.policies)
      setCrawlResultPage(1)
      setSelectedPolicyIds([])
      setProgress(100)
      setStatusText(data.policies.length > 0
        ? `${executionLabel}完成：取得 ${data.policies.length} 条工信部官方政策`
        : `${executionLabel}完成：所选关键词和日期范围内没有匹配政策`)
      setLogs((current) => [...current, ...data.logs.map((log, index) => ({
        id: `${Date.now()}-crawler-${index}`,
        time: getLogTime(),
        level: log.level,
        stage: log.stage,
        message: log.message,
      }))])
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const message = error instanceof Error ? error.message : '未知采集错误'
      setProgress(0)
      setStatusText(`政策采集失败：${message}`)
      appendLog('错误', '真实采集', message)
    } finally {
      if (crawlAbortRef.current === controller) crawlAbortRef.current = null
      setRunning(false)
    }
  }

  const handleStop = () => {
    crawlAbortRef.current?.abort()
    crawlAbortRef.current = null
    setRunning(false)
    setProgress(0)
    setStatusText('处理已停止')
    appendLog('警告', '任务控制', '用户已停止当前处理任务')
  }

  const normalizedRecipientSearch = recipientSearch.trim().toLocaleLowerCase('zh-CN')
  const filteredRecipients = recipients.filter((recipient) => {
    const matchesGroup = recipientGroupFilter === '全部分组' || recipient.group === recipientGroupFilter
    const matchesSearch = !normalizedRecipientSearch
      || `${recipient.name} ${recipient.email}`.toLocaleLowerCase('zh-CN').includes(normalizedRecipientSearch)
    return matchesGroup && matchesSearch
  })
  const selectedRecipientCount = recipients.filter((recipient) => selectedAudiences.includes(recipient.group)).length
  const deliveryAttachmentFilename = deliveryReport
    ? createMarkdownFilename(deliveryReport.policy.title, deliveryReport.skillId)
    : '尚未生成附件'
  const deliveryEmailSubject = deliveryReport
    ? `[政策分析报告] ${deliveryReport.reportType}｜${deliveryReport.policy.title}`
    : '尚未选择分析报告'

  return (
    <div className="app-shell">
      <header className="hero-header">
        <div className="hero-title">
          <Globe2 size={34} strokeWidth={2.2} />
          <h1>法律法规展示及政策解读</h1>
        </div>
        <p>模块三 · 让政策收集、整理、解读与推送更高效</p>
      </header>

      <main className="page-content">
        <nav className="task-switcher" aria-label="政策工作任务">
          <button
            type="button"
            className={activeTask === 'collect' ? 'active' : ''}
            onClick={() => setActiveTask('collect')}
            aria-current={activeTask === 'collect' ? 'page' : undefined}
          >
            <span className="task-switcher-icon"><FileSearch size={20} /></span>
            <span className="task-switcher-copy">
              <small>任务 1 · 步骤 01—02</small>
              <strong>政策发现与更新</strong>
              <i>检索政策，决定单次或定时执行</i>
            </span>
            <b>已接通</b>
          </button>
          <button
            type="button"
            className={activeTask === 'classify' ? 'active' : ''}
            onClick={() => setActiveTask('classify')}
            aria-current={activeTask === 'classify' ? 'page' : undefined}
          >
            <span className="task-switcher-icon"><FolderTree size={20} /></span>
            <span className="task-switcher-copy">
              <small>任务 2 · 步骤 03</small>
              <strong>政策分类标注</strong>
              <i>对采集结果逐条标注层级和类型</i>
            </span>
            <b>{classificationProcessingCount > 0
              ? `${classificationProcessingCount} 条分析中`
              : confirmedPolicies.length > 0
                ? `${confirmedPolicies.length} 条待确认`
                : '等待政策'}</b>
          </button>
          <button
            type="button"
            className={activeTask === 'interpret' ? 'active' : ''}
            onClick={() => setActiveTask('interpret')}
            aria-current={activeTask === 'interpret' ? 'page' : undefined}
          >
            <span className="task-switcher-icon"><BookOpenText size={20} /></span>
            <span className="task-switcher-copy">
              <small>任务 3 · 步骤 04</small>
              <strong>政策分析与解读</strong>
              <i>选择分析类型，调用对应 Skill</i>
            </span>
            <b>2 个 Skill</b>
          </button>
          <button
            type="button"
            className={activeTask === 'deliver' ? 'active' : ''}
            onClick={() => setActiveTask('deliver')}
            aria-current={activeTask === 'deliver' ? 'page' : undefined}
          >
            <span className="task-switcher-icon"><Send size={20} /></span>
            <span className="task-switcher-copy">
              <small>任务 4 · 步骤 05</small>
              <strong>邮件定向推送</strong>
              <i>把审核后的解读发送给指定人员</i>
            </span>
            <b>{recipients.length} 位联系人</b>
          </button>
        </nav>

        {activeTask === 'collect' && (
          <>
        <div className="start-guide">
          <Info size={18} />
          <div>
            <strong>任务 1 合并政策检索与执行方式</strong>
            <span>先确定查询什么、从哪里找和查询时间，再决定执行一次还是按计划重复执行。</span>
          </div>
        </div>

        <ConfigSection
          className="website-section"
          number="01"
          title="政策收集"
          subtitle="告诉系统需要关注什么，以及从哪里找"
          icon={<FileSearch size={22} />}
        >
          <div className="form-grid two-columns collection-grid">
            <FormField label="关注关键词" hint="多个关键词可用逗号隔开">
              <div className="input-with-icon">
                <Search size={17} />
                <input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
              </div>
              <div className="suggestion-row">
                <span>常用：</span>
                {keywordSuggestions.map((keyword) => (
                  <button
                    key={keyword}
                    type="button"
                    onClick={() => {
                      if (!keywords.includes(keyword)) setKeywords(`${keywords}${keywords ? '、' : ''}${keyword}`)
                    }}
                  >
                    + {keyword}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="主要网站" hint="可多选；优先选择官网中的政策库或政策列表入口">
              <div className="website-picker" ref={websitePickerRef}>
                <button
                  className={`website-trigger ${isWebsiteOpen ? 'open' : ''}`}
                  type="button"
                  onClick={() => setIsWebsiteOpen((current) => !current)}
                  aria-expanded={isWebsiteOpen}
                  aria-haspopup="listbox"
                >
                  <Link2 size={17} />
                  <span className="selected-websites">
                    {selectedWebsites.length === 0 ? (
                      <span className="website-placeholder">请选择主要网站</span>
                    ) : (
                      <>
                        {selectedWebsites.slice(0, 2).map((website) => (
                          <span className="selected-site-chip" key={website.id}>{website.name}</span>
                        ))}
                        {selectedWebsites.length > 2 && (
                          <span className="selected-count-chip">+{selectedWebsites.length - 2}</span>
                        )}
                      </>
                    )}
                  </span>
                  <ChevronDown className={`trigger-chevron ${isWebsiteOpen ? 'rotated' : ''}`} size={16} />
                </button>

                {isWebsiteOpen && (
                  <div className="website-popover">
                    <div className="website-popover-header">
                      <div>
                        <strong>选择政策来源</strong>
                        <span>可同时勾选多个网站</span>
                      </div>
                      <span className="selection-count">已选 {selectedWebsiteIds.length} 项</span>
                    </div>

                    <div className="website-list" role="listbox" aria-multiselectable="true">
                      {websites.map((website) => {
                        const selected = selectedWebsiteIds.includes(website.id)
                        return (
                          <div
                            className={`website-option ${selected ? 'selected' : ''}`}
                            key={website.id}
                            role="option"
                            aria-selected={selected}
                          >
                            <button className="website-option-main" type="button" onClick={() => toggleWebsite(website.id)}>
                              <span className="site-checkbox">{selected && <Check size={14} />}</span>
                              <span className="site-icon"><Globe2 size={18} /></span>
                              <span className="site-copy">
                                <strong>{website.name}</strong>
                                <small>{website.url.replace(/^https?:\/\//, '')}</small>
                              </span>
                            </button>
                            <div className="website-option-actions">
                              {!website.official && (
                                <button
                                  className="remove-option-button"
                                  type="button"
                                  onClick={() => removeWebsite(website.id)}
                                  title={`删除${website.name}`}
                                  aria-label={`删除自定义网站${website.name}`}
                                >
                                  <X size={14} />
                                </button>
                              )}
                              <span className={`site-type ${website.official ? 'official' : 'custom'}`}>
                                {website.official ? '官方' : '自定义'}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {isAddingWebsite ? (
                      <div className="website-add-form">
                        <div className="add-form-heading">
                          <div>
                            <strong>新增网站</strong>
                            <span>填写后将自动添加并选中</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsAddingWebsite(false)
                              setWebsiteError('')
                            }}
                            aria-label="关闭新增网站表单"
                          >
                            <X size={17} />
                          </button>
                        </div>
                        <div className="add-form-fields">
                          <label>
                            <span>网站名称</span>
                            <input
                              value={newWebsiteName}
                              onChange={(event) => {
                                setNewWebsiteName(event.target.value)
                                setWebsiteError('')
                              }}
                              placeholder="例如：中国标准服务网"
                              autoFocus
                            />
                          </label>
                          <label>
                            <span>政策入口链接</span>
                            <input
                              value={newWebsiteUrl}
                              onChange={(event) => {
                                setNewWebsiteUrl(event.target.value)
                                setWebsiteError('')
                              }}
                              placeholder="https://example.com/policy-list"
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') handleAddWebsite()
                              }}
                            />
                          </label>
                        </div>
                        {websiteError && <div className="website-error">{websiteError}</div>}
                        <div className="add-form-actions">
                          <button type="button" className="cancel-add" onClick={() => setIsAddingWebsite(false)}>取消</button>
                          <button type="button" className="confirm-add" onClick={handleAddWebsite}>确认添加</button>
                        </div>
                      </div>
                    ) : (
                      <button className="add-website-button" type="button" onClick={() => setIsAddingWebsite(true)}>
                        <span><Plus size={17} /></span>
                        <div>
                          <strong>新增网站</strong>
                          <small>优先添加具体政策库或政策列表页</small>
                        </div>
                      </button>
                    )}

                    <div className="website-popover-footer">
                      <ShieldCheck size={15} />
                      搜索时仅使用已勾选的 {selectedWebsiteIds.length} 个网站
                    </div>
                  </div>
                )}
              </div>
              <div className="website-scope-hint">
                <ShieldCheck size={14} />
                已选择 {selectedWebsiteIds.length} 个网站，将用于检索“{keywords || '尚未填写关键词'}”
              </div>
            </FormField>

            <FormField
              className="full-width-field"
              label="政策发布日期范围"
              hint="限定需要查询的政策发布时间，不等同于政策生效日期"
            >
              <div className="date-range-panel">
                <div className="date-preset-row" aria-label="常用政策发布日期范围">
                  {(['最近7天', '最近30天', '最近1年'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={dateRangePreset === preset ? 'selected' : ''}
                      onClick={() => applyDatePreset(preset)}
                      aria-pressed={dateRangePreset === preset}
                    >
                      {preset}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={dateRangePreset === '自定义' ? 'selected' : ''}
                    onClick={() => setDateRangePreset('自定义')}
                    aria-pressed={dateRangePreset === '自定义'}
                  >
                    自定义
                  </button>
                </div>

                <div className="date-input-row">
                  <label>
                    <span>开始日期</span>
                    <div className="date-input-wrap">
                      <CalendarDays size={17} />
                      <input
                        type="date"
                        value={startDate}
                        max={endDate || toDateInputValue(new Date())}
                        onChange={(event) => {
                          setStartDate(event.target.value)
                          setDateRangePreset('自定义')
                        }}
                      />
                    </div>
                  </label>
                  <span className="date-separator">至</span>
                  <label>
                    <span>结束日期</span>
                    <div className="date-input-wrap">
                      <CalendarDays size={17} />
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        max={toDateInputValue(new Date())}
                        onChange={(event) => {
                          setEndDate(event.target.value)
                          setDateRangePreset('自定义')
                        }}
                      />
                    </div>
                  </label>
                  <div className="date-range-summary">
                    <Clock3 size={16} />
                    <span>将查询 <strong>{dateRangeLabel}</strong> 正式发布的政策</span>
                  </div>
                </div>
              </div>
            </FormField>
          </div>
        </ConfigSection>

        <ConfigSection
          number="02"
          title="实时 / 定期更新"
          subtitle="决定系统多久检查一次新政策"
          icon={<CalendarClock size={22} />}
        >
          <div className="choice-row two-choice">
            <ChoiceCard
              selected={updateMode === '实时更新'}
              onClick={() => {
                setUpdateMode('实时更新')
                setIsScheduleOpen(false)
              }}
              icon={<Radio size={21} />}
              title="实时更新"
              description="持续关注网站变化，发现后尽快更新"
              note="适合重点网站"
            />
            <ChoiceCard
              selected={updateMode === '每周更新'}
              onClick={() => {
                setUpdateMode('每周更新')
                setIsScheduleOpen(true)
              }}
              icon={<CalendarClock size={21} />}
              title={scheduleFrequency === '每天' ? '每日更新' : scheduleFrequency === '每月' ? '每月更新' : '每周更新'}
              description={`${savedSchedule} 自动检查一次`}
              note="点击自定义定时任务"
            />
          </div>

          {updateMode === '每周更新' && isScheduleOpen && (
            <div className="schedule-editor">
              <div className="schedule-editor-header">
                <div className="schedule-editor-title">
                  <span><CalendarDays size={19} /></span>
                  <div>
                    <strong>自定义定时任务</strong>
                    <small>设置系统自动检查新政策的周期与时间</small>
                  </div>
                </div>
                <button type="button" onClick={() => setIsScheduleOpen(false)} aria-label="收起定时任务设置">
                  <X size={17} />
                </button>
              </div>

              <div className="schedule-editor-body">
                <div className="schedule-field">
                  <span className="schedule-label">执行周期</span>
                  <div className="frequency-control">
                    {(['每天', '每周', '每月'] as ScheduleFrequency[]).map((frequency) => (
                      <button
                        type="button"
                        key={frequency}
                        className={scheduleFrequency === frequency ? 'selected' : ''}
                        onClick={() => setScheduleFrequency(frequency)}
                      >
                        {scheduleFrequency === frequency && <Check size={14} />}
                        {frequency}
                      </button>
                    ))}
                  </div>
                </div>

                {scheduleFrequency === '每周' && (
                  <div className="schedule-field schedule-days-field">
                    <span className="schedule-label">执行日期</span>
                    <div className="weekday-selector">
                      {weekDays.map((day) => (
                        <button
                          type="button"
                          key={day}
                          className={selectedWeekDays.includes(day) ? 'selected' : ''}
                          onClick={() => toggleWeekDay(day)}
                          aria-pressed={selectedWeekDays.includes(day)}
                        >
                          {day.replace('周', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {scheduleFrequency === '每月' && (
                  <div className="schedule-field">
                    <span className="schedule-label">每月日期</span>
                    <div className="schedule-select-wrap">
                      <select value={monthlyDay} onChange={(event) => setMonthlyDay(event.target.value)}>
                        {Array.from({ length: 28 }, (_, index) => String(index + 1)).map((day) => (
                          <option key={day} value={day}>每月 {day} 日</option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </div>
                )}

                <div className="schedule-field">
                  <span className="schedule-label">执行时间</span>
                  <div className="time-input-wrap">
                    <Clock3 size={17} />
                    <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} />
                  </div>
                </div>
              </div>

              <div className="schedule-preview">
                <CalendarClock size={17} />
                <div>
                  <span>任务预览</span>
                  <strong>{formatSchedule()} 自动检查一次</strong>
                </div>
              </div>

              <div className="schedule-editor-footer">
                <span>当前仅保存页面配置，尚未创建真实系统任务</span>
                <div>
                  <button type="button" className="schedule-cancel" onClick={() => setIsScheduleOpen(false)}>取消</button>
                  <button type="button" className="schedule-save" onClick={saveSchedule}>
                    <Check size={15} />
                    保存定时任务
                  </button>
                </div>
              </div>
            </div>
          )}
        </ConfigSection>
          </>
        )}

        {activeTask === 'classify' && (
          <>
            <TaskWorkspaceIntro
              label="任务 2 · 独立工作页"
              title="政策分类标注"
              description="从任务 1 的采集结果中选择一条政策，判断它属于国家级还是地方级，并标注为通用政策或产业专用政策。"
              input={`${confirmedPolicies.length} 条用户确认的政策`}
              output="带层级与类型标签的政策"
              status={classificationProcessingCount > 0
                ? `正在自动处理 ${classificationProcessingCount} 条政策：先生成标题与摘要 JSON，再调用大模型。`
                : completedClassificationCount > 0
                  ? `${completedClassificationCount} 条政策已获得模型建议，等待用户确认或自定义调整。`
                  : modelUnconfiguredCount > 0
                    ? '标题与摘要 JSON 已生成；请在 .env.local 配置模型后重新确认政策。'
                    : confirmedPolicies.length > 0
                      ? '政策已经进入分类列表，等待自动分析结果。'
                      : '尚无待分类政策，请先到任务 1 选择有用政策并确认。'}
            />
            <section className="classification-workspace">
              <div className="classification-heading">
                <div className="classification-heading-title">
                  <span><FolderTree size={19} /></span>
                  <div>
                    <strong>待分类政策</strong>
                    <small>一行一条展示任务 1 中由用户确认有用的政策</small>
                  </div>
                </div>
                <div className="classification-heading-tools">
                  <label>
                    <span>政策层级</span>
                    <select
                      value={classificationLevelFilter}
                      onChange={(event) => setClassificationLevelFilter(event.target.value)}
                    >
                      <option>全部层级</option>
                      {administrativeLevelOptions.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>适用类型</span>
                    <select
                      value={classificationCategoryFilter}
                      onChange={(event) => setClassificationCategoryFilter(event.target.value)}
                    >
                      <option>全部类型</option>
                      {policyCategoryOptions.map((option) => <option key={option}>{option}</option>)}
                    </select>
                  </label>
                  <b>{filteredConfirmedPolicies.length} 条</b>
                </div>
              </div>

              {confirmedPolicies.length > 0 ? (
                <div className="classification-policy-list">
                  {filteredConfirmedPolicies.length > 0 ? filteredConfirmedPolicies.map((policy) => {
                    const analysis = policyAnalyses[policy.id]
                    const draft = classificationDrafts[policy.id]
                    const isProcessing = !analysis || ['queued', 'analyzing'].includes(analysis.status)
                    const displayedLevel = draft?.administrativeLevel
                      || analysis?.classification?.administrativeLevel
                      || '待模型判断'
                    const displayedCategory = draft?.policyCategory
                      || analysis?.classification?.policyCategory
                      || '待模型判断'
                    const policySummary = cleanSummaryText(
                      analysis?.preprocessing?.content.summary
                        || policy.contentPreview
                        || '暂无正文摘要。',
                    )
                    const isExpanded = expandedAnalysisPolicyId === policy.id
                    const statusLabel = isProcessing
                      ? '自动分析中'
                      : draft?.manuallyAdjusted
                        ? '人工已调整'
                        : analysis?.status === 'completed'
                          ? '模型建议'
                          : analysis?.status === 'model_unconfigured'
                            ? '模型未配置'
                            : '分析失败'
                    return (
                    <article className={`classification-policy-card analysis-${analysis?.status || 'queued'}${isExpanded ? ' expanded' : ''}`} key={policy.id}>
                      <div className="classification-policy-row">
                      <div className="classification-policy-info">
                        <div className="policy-result-badges">
                          <span>{policy.documentType || '政策文件'}</span>
                          {policy.theme && <span>{policy.theme}</span>}
                          <i>用户已确认</i>
                        </div>
                        <a href={policy.url} target="_blank" rel="noreferrer">
                          {policy.title}
                          <ExternalLink size={14} />
                        </a>
                        <div className="classification-policy-summary">
                          <p tabIndex={0}>{policySummary}</p>
                          <div className="classification-summary-tooltip" role="tooltip">
                            <strong>完整摘要</strong>
                            <span>{policySummary}</span>
                          </div>
                        </div>
                      </div>

                      <dl className="classification-policy-meta">
                        <div><dt>发布日期</dt><dd>{policy.publishedAt || '待核对'}</dd></div>
                        <div><dt>发布机构</dt><dd>{policy.publisher || '待核对'}</dd></div>
                        <div><dt>文号</dt><dd>{policy.documentNumber || '未公开'}</dd></div>
                        <div><dt>附件</dt><dd>{policy.attachments.length} 个</dd></div>
                      </dl>

                      <label className="classification-inline-field">
                        <span>政策层级</span>
                        <select
                          aria-label={`${policy.title}的政策层级`}
                          value={displayedLevel}
                          disabled={isProcessing}
                          onChange={(event) => applyClassificationOverride(policy.id, 'administrativeLevel', event.target.value)}
                        >
                          {!administrativeLevelOptions.includes(displayedLevel) && (
                            <option value={displayedLevel} disabled>{displayedLevel}</option>
                          )}
                          {administrativeLevelOptions.map((option) => <option key={option}>{option}</option>)}
                        </select>
                        <small>{analysis?.classification
                          ? `模型置信度 ${Math.round(analysis.classification.confidence * 100)}%`
                          : '等待模型建议'}</small>
                      </label>

                      <label className="classification-inline-field">
                        <span>适用类型</span>
                        <select
                          aria-label={`${policy.title}的适用类型`}
                          value={displayedCategory}
                          disabled={isProcessing}
                          onChange={(event) => applyClassificationOverride(policy.id, 'policyCategory', event.target.value)}
                        >
                          {!policyCategoryOptions.includes(displayedCategory) && (
                            <option value={displayedCategory} disabled>{displayedCategory}</option>
                          )}
                          {policyCategoryOptions.map((option) => <option key={option}>{option}</option>)}
                        </select>
                        <small>{draft?.manuallyAdjusted ? '人工已调整' : '可点击调整'}</small>
                      </label>

                      <div className="classification-detail-cell">
                        <button
                          type="button"
                          className="classification-detail-trigger"
                          title={isExpanded ? '收起模型判断详情' : '展开模型判断详情'}
                          aria-label={isExpanded ? '收起模型判断详情' : '展开模型判断详情'}
                          aria-expanded={isExpanded}
                          onClick={() => setExpandedAnalysisPolicyId(isExpanded ? null : policy.id)}
                        >
                          <Sparkles size={17} />
                          <span>分析详情</span>
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          className="policy-interpretation-trigger"
                          onClick={() => openPolicyInterpretation(policy)}
                        >
                          <BookOpenText size={16} />
                          <span>政策分析</span>
                        </button>
                      </div>
                      </div>

                      {isExpanded && (
                        <div className="classification-detail-drawer">
                          <div className="classification-detail-drawer-heading">
                            <div>
                              <span><Sparkles size={18} /></span>
                              <div>
                                <strong>模型判断详情</strong>
                                <small>标题 JSON → 摘要 JSON → 模型判断</small>
                              </div>
                            </div>
                            <b className={analysis?.status || 'queued'}>{statusLabel}</b>
                          </div>
                          <div className="classification-detail-drawer-body">
                            {analysis?.classification && (
                              <div className="model-classification-reasoning">
                                <strong>模型判断依据</strong>
                                <p>{analysis.classification.reasoning}</p>
                                {analysis.classification.evidence.length > 0 && (
                                  <ul>{analysis.classification.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
                                )}
                              </div>
                            )}
                            {analysis?.status === 'model_unconfigured' && (
                              <p className="model-message warning">结构化 JSON 已生成。填写 `.env.local` 并重启服务后，重新确认即可自动获得模型建议。</p>
                            )}
                            {analysis?.status === 'error' && (
                              <p className="model-message error">自动分析失败：{analysis.error}</p>
                            )}
                            {isProcessing && (
                              <p className="model-message processing">正在补抓政策全文、生成结构化 JSON 并等待模型返回。</p>
                            )}
                            {analysis?.preprocessing && (
                              <details className="structured-json-details">
                                <summary>查看标题与摘要 JSON</summary>
                                <pre>{JSON.stringify(analysis.preprocessing, null, 2)}</pre>
                              </details>
                            )}
                            <p className="model-reference-note">模型结论仅供参考；层级和类型可直接在列表中修改。</p>
                          </div>
                        </div>
                      )}
                    </article>
                    )
                  }) : (
                    <div className="classification-filter-empty">
                      <Search size={21} />
                      <strong>没有符合当前筛选条件的政策</strong>
                      <span>可以调整政策层级或适用类型，查看其他政策。</span>
                      <button
                        type="button"
                        onClick={() => {
                          setClassificationLevelFilter('全部层级')
                          setClassificationCategoryFilter('全部类型')
                        }}
                      >
                        清除筛选
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="classification-empty">
                  <FolderTree size={25} />
                  <strong>还没有待分类政策</strong>
                  <span>请先到任务 1 检索政策，选择有用的结果并确认。</span>
                  <button type="button" onClick={() => setActiveTask('collect')}>返回政策发现与更新</button>
                </div>
              )}
            </section>
          </>
        )}

        {activeTask === 'interpret' && (
          <>
            <TaskWorkspaceIntro
              label="任务 3 · 独立工作页"
              title="政策分析与解读"
              description="从已完成分类的政策中选定具体文件，再选择专家解读或条款拆解，由对应 Skill 按固定框架生成可复核报告。"
              input={interpretationPolicy ? `《${interpretationPolicy.title}》` : '尚未选择需要分析的政策'}
              output="专家解读报告或条款拆解报告"
              status={interpretationPolicy
                ? '分析对象已确定，请选择分析类型与主体后生成报告。'
                : '请先到任务 2 点击某条政策右侧的“政策分析”。'}
            />
            <ConfigSection
              number="04 · 1"
              title="分析政策文件"
              subtitle="确认本次需要生成分析报告的政策对象"
              icon={<FileSearch size={22} />}
            >
              {interpretationPolicy ? (
                <article className="interpretation-policy-card">
                  <div className="policy-result-badges">
                    <span>{interpretationPolicy.documentType || '政策文件'}</span>
                    {interpretationPolicy.theme && <span>{interpretationPolicy.theme}</span>}
                    <i>来自政策分类标注</i>
                  </div>
                  <a href={interpretationPolicy.url} target="_blank" rel="noreferrer">
                    {interpretationPolicy.title}
                    <ExternalLink size={15} />
                  </a>
                  <p>{interpretationPolicySummary || '暂无政策摘要。'}</p>
                  <dl>
                    <div><dt>发布日期</dt><dd>{interpretationPolicy.publishedAt || '待核对'}</dd></div>
                    <div><dt>发布机构</dt><dd>{interpretationPolicy.publisher || '待核对'}</dd></div>
                    <div><dt>文号</dt><dd>{interpretationPolicy.documentNumber || '未公开'}</dd></div>
                  </dl>
                </article>
              ) : (
                <div className="interpretation-policy-empty">
                  <FileSearch size={24} />
                  <div>
                    <strong>尚未选择政策文件</strong>
                    <span>请从政策分类标注列表中选择一条政策进入分析。</span>
                  </div>
                  <button type="button" onClick={() => setActiveTask('classify')}>前往政策分类标注</button>
                </div>
              )}
            </ConfigSection>

            <ConfigSection
              number="04 · 2"
              title="政策分析"
              subtitle="针对选定的政策文件设置分析类型与分析主体"
              icon={<BookOpenText size={22} />}
            >
              <div className="interpretation-layout">
                <div>
                  <span className="group-label">分析类型</span>
                  <div className="choice-row summary-choices">
                    <ChoiceCard
                      selected={interpretationSkill === 'policy-expert-interpretation'}
                      skillId="policy-expert-interpretation"
                      onClick={() => setInterpretationSkill('policy-expert-interpretation')}
                      icon={<Sparkles size={21} />}
                      title="专家解读型"
                      description="形成完整的政策专家解读报告"
                      note="适合行业影响研判与应对规划"
                    />
                    <ChoiceCard
                      selected={interpretationSkill === 'policy-clause-analysis'}
                      skillId="policy-clause-analysis"
                      onClick={() => setInterpretationSkill('policy-clause-analysis')}
                      icon={<ListChecks size={21} />}
                      title="条款拆解型"
                      description="逐条拆解政策要求与合规要点"
                      note="适合条款核对与合规落实"
                    />
                  </div>
                </div>

                <FormField label="分析主体" hint="报告将面向所选主体组织重点与行动建议">
                  <div className="select-wrap">
                    <Users size={17} />
                    <select value={interpreter} onChange={(event) => setInterpreter(event.target.value)}>
                      <option>标准化管理组</option>
                      <option>政策研究组</option>
                      <option>法务与合规组</option>
                      <option>研发/产品设计组</option>
                      <option>质量管理组</option>
                      <option>高层管理/决策层</option>
                      <option>其他</option>
                    </select>
                    <ChevronDown size={16} />
                  </div>
                  {interpreter === '其他' && (
                    <div className="custom-analysis-audience">
                      <Users size={16} />
                      <input
                        value={customInterpreter}
                        onChange={(event) => setCustomInterpreter(event.target.value)}
                        placeholder="请输入分析主体，例如：供应链管理组"
                        aria-label="自定义分析主体"
                      />
                    </div>
                  )}
                </FormField>
              </div>
              <div className="interpretation-run-bar">
                <div>
                  <span>本次分析配置</span>
                  <strong>{interpretationSkill === 'policy-expert-interpretation' ? '专家解读型' : '条款拆解型'} · {selectedAnalysisAudience || '请填写分析主体'}</strong>
                </div>
                <button
                  type="button"
                  onClick={runPolicyInterpretation}
                  disabled={!interpretationPolicy || !selectedAnalysisAudience || interpretationStatus === 'running'}
                >
                  <Sparkles size={17} />
                  {interpretationStatus === 'running'
                    ? '正在生成报告…'
                    : interpretationStatus === 'completed'
                      ? '重新生成分析报告'
                      : '生成分析报告'}
                </button>
              </div>
            </ConfigSection>

            <ConfigSection
              number="04 · 3"
              title="分析结果"
              subtitle="查看 DeepSeek 生成的 Markdown 报告，并复制或保存到本地"
              icon={<ListChecks size={22} />}
              action={(
                <div className="section-action-group">
                  <button
                    type="button"
                    className="section-secondary-action"
                    onClick={saveInterpretationReport}
                    disabled={interpretationStatus !== 'completed' || !interpretationReport}
                  >
                    <Download size={16} />
                    保存本地
                  </button>
                  <button
                    type="button"
                    className="section-primary-action"
                    onClick={openReportDelivery}
                    disabled={interpretationStatus !== 'completed' || !interpretationReport}
                  >
                    <Send size={16} />
                    推送报告
                  </button>
                </div>
              )}
            >
              <div className={`interpretation-result interpretation-result-${interpretationStatus}`}>
                {interpretationStatus === 'idle' && (
                  <div className="interpretation-result-placeholder">
                    <BookOpenText size={27} />
                    <strong>分析报告将在这里显示</strong>
                    <span>先确认政策文件、分析类型和分析主体，再点击“生成分析报告”。</span>
                  </div>
                )}
                {interpretationStatus === 'running' && (
                  <div className="interpretation-result-placeholder running">
                    <Sparkles size={27} />
                    <strong>正在调用 DeepSeek 生成报告</strong>
                    <span>系统正在读取完整政策原文并按照所选分析框架组织内容。</span>
                  </div>
                )}
                {interpretationStatus === 'error' && (
                  <div className="interpretation-result-error">
                    <AlertCircle size={20} />
                    <div><strong>分析失败</strong><span>{interpretationError}</span></div>
                  </div>
                )}
                {interpretationStatus === 'completed' && (
                  <>
                    <div className="interpretation-result-toolbar">
                      <div>
                        <strong>{(interpretationReportSkill || interpretationSkill) === 'policy-expert-interpretation' ? '专家解读报告' : '条款拆解报告'}</strong>
                        <span>排版预览 · 面向 {interpretationReportAudience || selectedAnalysisAudience}</span>
                      </div>
                      <div>
                        <button type="button" className="primary" onClick={copyInterpretationReport}>复制报告原文</button>
                      </div>
                    </div>
                    <article className="interpretation-markdown-report">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{interpretationReport}</ReactMarkdown>
                    </article>
                    {reportActionMessage && <p className="report-action-message">{reportActionMessage}</p>}
                  </>
                )}
              </div>
            </ConfigSection>
          </>
        )}

        {activeTask === 'collect' && (
          <>
        <section className="action-panel">
          <div className="action-copy">
            <span>政策检索配置完成</span>
            <strong>{updateMode === '实时更新' ? '立即执行实时政策检查' : '执行一次定期任务验证'}</strong>
            <small>{updateMode === '实时更新'
              ? '点击后立即真实访问工信部政策文件库；本 Demo 不持续轮询。'
              : `当前计划为“${savedSchedule}”；点击后先手动验证一次，后台定时器后续接入。`}</small>
          </div>
          <div className="action-buttons">
            <button className="start-button" type="button" onClick={handleStart} disabled={running}>
              <Play size={18} fill="currentColor" />
              {updateMode === '实时更新' ? '开始实时检查' : '开始验证'}
            </button>
            <button className="stop-button" type="button" onClick={handleStop} disabled={!running}>
              <CircleStop size={18} />
              停止
            </button>
          </div>
        </section>

        <section className="progress-panel">
          <div className="progress-heading">
            <div>
              <strong>处理进度</strong>
              <span>{statusText}</span>
            </div>
            <b>{progress}%</b>
          </div>
          <div className="progress-track" aria-label={`处理进度 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="realtime-log">
            <div className="log-heading">
              <div className="log-title">
                <span><SquareTerminal size={18} /></span>
                <div>
                  <strong>实时日志</strong>
                  <small>记录每个处理阶段，错误会明确标出发生位置</small>
                </div>
              </div>
              <div className="log-heading-actions">
                <span className={`log-listening ${running ? 'running' : ''}`}>
                  <i />
                  {running ? '正在监听' : '等待任务'}
                </span>
                <button type="button" onClick={() => setLogs([])} disabled={logs.length === 0}>
                  <Trash2 size={14} />
                  清空日志
                </button>
              </div>
            </div>

            <div className="log-console" ref={logContainerRef} aria-live="polite" aria-label="实时处理日志">
              {logs.length === 0 ? (
                <div className="log-empty">
                  <SquareTerminal size={20} />
                  暂无日志，点击“开始处理”后将在这里显示运行信息
                </div>
              ) : logs.map((log) => (
                <div className={`log-row log-${logLevelClass[log.level]}`} key={log.id}>
                  <time>{log.time}</time>
                  <span className="log-level">{log.level}</span>
                  <strong>{log.stage}</strong>
                  <p>{log.message}</p>
                </div>
              ))}
            </div>

            <div className="log-footer-note">
              <AlertCircle size={14} />
              工信部访问与政策解析错误会在此记录；AI 解读和其他网站仍未接入。
            </div>
          </div>

          {crawlAttempted && (
            <div className="crawl-results">
              <div className="crawl-results-header">
                <div>
                  <span><FileSearch size={18} /></span>
                  <div>
                    <strong>本次真实采集结果</strong>
                    <small>数据来自工信部政策文件库，点击标题可核对官方原文</small>
                  </div>
                </div>
                <b>{crawledPolicies.length} 条</b>
              </div>

              {crawledPolicies.length > 0 ? (
                <>
                  <div className="policy-selection-toolbar">
                    <button type="button" className="select-all-policies" onClick={toggleAllPolicies}>
                      <span className={selectedPolicyIds.length === crawledPolicies.length ? 'checked' : ''}>
                        {selectedPolicyIds.length === crawledPolicies.length && <Check size={13} />}
                      </span>
                      {selectedPolicyIds.length === crawledPolicies.length ? '取消全选' : '全选本次结果'}
                    </button>
                    <div>
                      <span>已选择 <strong>{selectedPolicyIds.length}</strong> 条有用政策</span>
                      <button
                        type="button"
                        className="confirm-selection-button"
                        onClick={confirmPoliciesForClassification}
                        disabled={selectedPolicyIds.length === 0}
                      >
                        确认并进入分类标注
                        <FolderTree size={16} />
                      </button>
                    </div>
                  </div>

                <div className="policy-result-list">
                  {paginatedCrawledPolicies.map((policy) => (
                    <article
                      className={`policy-result-card ${selectedPolicyIds.includes(policy.id) ? 'selected' : ''}`}
                      key={policy.id}
                    >
                      <button
                        type="button"
                        className="policy-select-toggle"
                        onClick={() => togglePolicySelection(policy.id)}
                        aria-pressed={selectedPolicyIds.includes(policy.id)}
                        aria-label={`${selectedPolicyIds.includes(policy.id) ? '取消选择' : '选择'}政策：${policy.title}`}
                      >
                        {selectedPolicyIds.includes(policy.id) && <Check size={15} />}
                      </button>
                      <div className="policy-result-main">
                        <div className="policy-result-badges">
                          <span>{policy.documentType || '政策文件'}</span>
                          {policy.theme && <span>{policy.theme}</span>}
                          <i>官方来源</i>
                        </div>
                        <a href={policy.url} target="_blank" rel="noreferrer">
                          {policy.title}
                          <ExternalLink size={14} />
                        </a>
                        <p>{policy.contentPreview || '该政策已取得官方元数据，暂无正文摘要。'}</p>
                      </div>
                      <dl>
                        <div><dt>发布日期</dt><dd>{policy.publishedAt || '待核对'}</dd></div>
                        <div><dt>发布机构</dt><dd>{policy.publisher || '工业和信息化部'}</dd></div>
                        <div><dt>文号</dt><dd>{policy.documentNumber || '未公开'}</dd></div>
                        <div><dt>附件</dt><dd>{policy.attachments.length} 个</dd></div>
                      </dl>
                    </article>
                  ))}
                  {crawlResultPageCount > 1 && (
                    <nav className="crawl-result-pagination" aria-label="采集结果分页">
                      <span>
                        第 {crawlResultPage} / {crawlResultPageCount} 页，共 {crawledPolicies.length} 条
                      </span>
                      <div>
                        <button
                          type="button"
                          className="pagination-step"
                          onClick={() => setCrawlResultPage((page) => Math.max(1, page - 1))}
                          disabled={crawlResultPage === 1}
                          aria-label="上一页"
                        >
                          <ChevronLeft size={15} />
                          上一页
                        </button>
                        {Array.from({ length: crawlResultPageCount }, (_, index) => index + 1).map((page) => (
                          <button
                            type="button"
                            className={`pagination-page ${page === crawlResultPage ? 'active' : ''}`}
                            onClick={() => setCrawlResultPage(page)}
                            aria-current={page === crawlResultPage ? 'page' : undefined}
                            aria-label={`第 ${page} 页`}
                            key={page}
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="pagination-step"
                          onClick={() => setCrawlResultPage((page) => Math.min(crawlResultPageCount, page + 1))}
                          disabled={crawlResultPage === crawlResultPageCount}
                          aria-label="下一页"
                        >
                          下一页
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </nav>
                  )}
                </div>
                </>
              ) : (
                <div className="empty-crawl-result">
                  {running ? '正在等待工信部返回政策数据…' : '所选关键词和发布日期范围内没有匹配政策。'}
                </div>
              )}
            </div>
          )}
        </section>
          </>
        )}

        {activeTask === 'deliver' && (
          <>
            <TaskWorkspaceIntro
              label="任务 4 · 独立工作页"
              title="邮件定向推送"
              description="选择已经审核通过的政策解读，根据政策管理主体与关注关系，通过邮件发送给指定人员并保留发送状态。"
              input={deliveryReport ? `《${deliveryReport.policy.title}》的${deliveryReport.reportType}` : '尚未选择分析报告'}
              output="发送记录与接收状态"
              status={deliveryReport
                ? '分析报告已进入推送任务，请选择分组并确认联系人。'
                : '请先到任务 3 生成分析报告，并点击“推送报告”。'}
            />
        <ConfigSection
          className="delivery-report-section"
          number="05 · 1"
          title="待推送分析报告"
          subtitle="确认本次需要发送的政策分析报告"
          icon={<FileSearch size={22} />}
        >
          {deliveryReport ? (
            <article className="delivery-report-card">
              <div className="delivery-report-main">
                <div className="policy-result-badges">
                  <span>{deliveryReport.reportType}</span>
                  <span>面向 {deliveryReport.analysisAudience}</span>
                  <i>来自政策分析与解读</i>
                </div>
                <a href={deliveryReport.policy.url} target="_blank" rel="noreferrer">
                  {deliveryReport.policy.title}
                  <ExternalLink size={15} />
                </a>
                <p>{cleanSummaryText(deliveryReport.policy.contentPreview || deliveryReport.policy.content).slice(0, 180) || '暂无政策摘要。'}</p>
              </div>
              <dl>
                <div><dt>发布日期</dt><dd>{deliveryReport.policy.publishedAt || '待核对'}</dd></div>
                <div><dt>发布机构</dt><dd>{deliveryReport.policy.publisher || '待核对'}</dd></div>
                <div><dt>文号</dt><dd>{deliveryReport.policy.documentNumber || '未公开'}</dd></div>
                <div><dt>报告生成</dt><dd>{new Date(deliveryReport.generatedAt).toLocaleString('zh-CN', { hour12: false })}</dd></div>
              </dl>
            </article>
          ) : (
            <div className="delivery-report-empty">
              <BookOpenText size={25} />
              <div>
                <strong>尚未选择分析报告</strong>
                <span>请先在任务 3 生成报告，再点击“推送报告”。</span>
              </div>
              <button type="button" onClick={() => setActiveTask('interpret')}>前往政策分析与解读</button>
            </div>
          )}
        </ConfigSection>
        <ConfigSection
          number="05"
          title="精准推送"
          subtitle="选择需要接收本次政策解读的推送分组"
          icon={<Send size={22} />}
          action={(
            <button
              type="button"
              className="section-primary-action"
              onClick={checkReportDelivery}
              disabled={!deliveryReport || deliveryStatus === 'sending'}
            >
              <Send size={16} />
              {deliveryStatus === 'sending' ? '正在推送…' : '推送'}
            </button>
          )}
        >
          {deliveryReport && (
            <div className="email-delivery-preview">
              <div className="email-delivery-preview-heading">
                <div className="section-icon"><Send size={20} /></div>
                <div>
                  <strong>邮件内容预览</strong>
                  <span>正文用于说明报告信息，完整内容以 Markdown 附件发送</span>
                </div>
              </div>
              <dl>
                <div>
                  <dt>邮件标题</dt>
                  <dd>{deliveryEmailSubject}</dd>
                </div>
                <div>
                  <dt>政策原文</dt>
                  <dd>
                    <a href={deliveryReport.policy.url} target="_blank" rel="noreferrer">
                      查看政策官方原文
                      <ExternalLink size={13} />
                    </a>
                  </dd>
                </div>
                <div>
                  <dt>正文信息</dt>
                  <dd>
                    {deliveryReport.reportType} · {deliveryReport.administrativeLevel} · {deliveryReport.policyCategory} · 面向 {deliveryReport.analysisAudience}
                  </dd>
                </div>
                <div>
                  <dt>报告附件</dt>
                  <dd><BookOpenText size={15} />{deliveryAttachmentFilename}</dd>
                </div>
              </dl>
            </div>
          )}
          <span className="group-label">推送分组</span>
          <div className="audience-row">
            {audiences.map((audience) => {
              const selected = selectedAudiences.includes(audience)
              const recipientCount = recipients.filter((recipient) => recipient.group === audience).length
              return (
                <button
                  type="button"
                  key={audience}
                  className={selected ? 'selected' : ''}
                  onClick={() => toggleAudience(audience)}
                >
                  <span className="checkbox">{selected && <Check size={13} />}</span>
                  <Users size={18} />
                  <span className="audience-card-copy">
                    <strong>{audience}</strong>
                    <small>{recipientCount} 位联系人</small>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="helper-strip">
            <BellRing size={16} />
            已选择 {selectedAudiences.length} 个分组，共 {selectedRecipientCount} 位联系人。
            <strong>{notificationConfigured ? (notificationVerified ? 'SMTP 已验证' : 'SMTP 已配置，等待验证') : 'SMTP 未配置'}</strong>
          </div>
          {deliveryMessage && (
            <div className={`delivery-feedback ${deliveryStatus}`} role="status">
              {deliveryStatus === 'error'
                ? <AlertCircle size={17} />
                : deliveryStatus === 'sending'
                  ? <Sparkles size={17} />
                  : <ShieldCheck size={17} />}
              <span>{deliveryMessage}</span>
            </div>
          )}
        </ConfigSection>
        <ConfigSection
          className="recipient-directory-section"
          number="05 · 通讯录"
          title="收件人通讯录"
          subtitle="按推送分组查看联系人，并维护姓名与邮箱"
          icon={<Users size={22} />}
        >
          <div className="recipient-directory-toolbar">
            <label className="recipient-search-field">
              <span>搜索联系人</span>
              <div>
                <Search size={17} />
                <input
                  type="search"
                  value={recipientSearch}
                  onChange={(event) => setRecipientSearch(event.target.value)}
                  placeholder="输入姓名或邮箱"
                />
              </div>
            </label>
            <label className="recipient-filter-field">
              <span>所属分组</span>
              <select
                value={recipientGroupFilter}
                onChange={(event) => setRecipientGroupFilter(event.target.value as RecipientGroupFilter)}
              >
                <option value="全部分组">全部分组</option>
                {audiences.map((audience) => <option key={audience} value={audience}>{audience}</option>)}
              </select>
            </label>
            <div className="recipient-toolbar-summary" aria-live="polite">
              <span>筛选结果</span>
              <strong>{filteredRecipients.length} 人</strong>
            </div>
            <button type="button" className="recipient-add-button" onClick={openNewRecipientEditor}>
              <Plus size={17} />
              新增联系人
            </button>
          </div>

          {isRecipientEditorOpen && (
            <div className="recipient-editor" aria-label={editingRecipientId ? '编辑联系人' : '新增联系人'}>
              <div className="recipient-editor-heading">
                <div>
                  <strong>{editingRecipientId ? '编辑联系人' : '新增联系人'}</strong>
                  <span>联系人将归入一个推送分组</span>
                </div>
                <button type="button" aria-label="关闭联系人编辑" onClick={closeRecipientEditor}><X size={17} /></button>
              </div>
              <div className="recipient-editor-grid">
                <label>
                  <span>姓名</span>
                  <input
                    value={recipientDraft.name}
                    onChange={(event) => setRecipientDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="例如：张晓"
                  />
                </label>
                <label>
                  <span>邮箱</span>
                  <input
                    type="email"
                    value={recipientDraft.email}
                    onChange={(event) => setRecipientDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="name@example.com"
                  />
                </label>
                <label>
                  <span>所属分组</span>
                  <select
                    value={recipientDraft.group}
                    onChange={(event) => setRecipientDraft((current) => ({
                      ...current,
                      group: event.target.value as RecipientGroup,
                    }))}
                  >
                    {audiences.map((audience) => <option key={audience} value={audience}>{audience}</option>)}
                  </select>
                </label>
              </div>
              <div className="recipient-editor-footer">
                <span className={recipientError ? 'recipient-editor-error visible' : 'recipient-editor-error'}>{recipientError}</span>
                <div>
                  <button type="button" className="secondary" onClick={closeRecipientEditor}>取消</button>
                  <button type="button" className="primary" onClick={saveRecipient}><Check size={16} />保存联系人</button>
                </div>
              </div>
            </div>
          )}

          <div className="recipient-table" aria-label="收件人列表">
            <div className="recipient-table-header" aria-hidden="true">
              <span>联系人</span>
              <span>邮箱</span>
              <span>所属分组</span>
              <span>操作</span>
            </div>
            {filteredRecipients.map((recipient) => (
              <article className="recipient-row" key={recipient.id}>
                <div className="recipient-identity">
                  <span>{recipient.name.slice(0, 1)}</span>
                  <div><strong>{recipient.name}</strong><small>联系人</small></div>
                </div>
                <a href={`mailto:${recipient.email}`}>{recipient.email}</a>
                <span className="recipient-group-badge">{recipient.group}</span>
                <div className="recipient-row-actions">
                  <button type="button" onClick={() => openRecipientEditor(recipient)}>编辑</button>
                  <button type="button" className="danger" onClick={() => removeRecipient(recipient.id)}>
                    <Trash2 size={14} />删除
                  </button>
                </div>
              </article>
            ))}
            {filteredRecipients.length === 0 && (
              <div className="recipient-empty">
                <Users size={24} />
                <strong>没有符合条件的联系人</strong>
                <span>可以更换筛选条件，或新增一位联系人。</span>
              </div>
            )}
          </div>
          <p className="recipient-directory-note">
            联系人邮箱会同步到当前运行服务的测试白名单；服务重启后恢复 Secret 中的初始名单，正式持久化将在数据库阶段接入。
          </p>
        </ConfigSection>
          </>
        )}
      </main>
      {notificationAuthOpen && (
        <div className="notification-auth-overlay" role="presentation">
          <section className="notification-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-auth-title">
            <div className="notification-auth-heading">
              <div className="section-icon"><ShieldCheck size={21} /></div>
              <div>
                <strong id="notification-auth-title">验证邮件管理权限</strong>
                <span>首次新增、删除联系人或发送邮件时，需要建立当前浏览器会话授权。</span>
              </div>
              <button
                type="button"
                aria-label="关闭管理权限验证"
                onClick={() => {
                  setNotificationAuthOpen(false)
                  setNotificationAccessToken('')
                  setNotificationAuthError('')
                  setPendingNotificationOperation(null)
                }}
              >
                <X size={18} />
              </button>
            </div>
            <label className="notification-auth-field">
              <span>管理验证码</span>
              <input
                type="password"
                value={notificationAccessToken}
                onChange={(event) => setNotificationAccessToken(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitNotificationAuthorization()
                }}
                autoComplete="one-time-code"
                autoFocus
                placeholder="请输入本地 Secret 中的管理验证码"
              />
            </label>
            {notificationAuthError && <p className="notification-auth-error">{notificationAuthError}</p>}
            <div className="notification-auth-note">
              <Info size={15} />
              验证码只提交给本机服务端，不会写入前端存储或日志。
            </div>
            <div className="notification-auth-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setNotificationAuthOpen(false)
                  setNotificationAccessToken('')
                  setPendingNotificationOperation(null)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void submitNotificationAuthorization()}
                disabled={!notificationAccessToken.trim() || notificationAuthRunning}
              >
                <ShieldCheck size={16} />
                {notificationAuthRunning ? '正在验证…' : '验证并继续'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function TaskWorkspaceIntro({
  label,
  title,
  description,
  input,
  output,
  status,
}: {
  label: string
  title: string
  description: string
  input: string
  output: string
  status: string
}) {
  return (
    <section className="task-workspace-intro">
      <div className="task-workspace-copy">
        <span>{label}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="task-workspace-boundary" aria-label={`${title}的输入和输出`}>
        <div>
          <span>输入</span>
          <strong>{input}</strong>
        </div>
        <i>进入当前任务</i>
        <div>
          <span>输出</span>
          <strong>{output}</strong>
        </div>
      </div>
      <div className="task-workspace-status">
        <Info size={15} />
        {status}
      </div>
    </section>
  )
}

function ConfigSection({
  className = '',
  number,
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  className?: string
  number: string
  title: string
  subtitle: string
  icon: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className={`config-section ${className}`}>
      <div className="section-header">
        <div className="section-icon">{icon}</div>
        <div className="section-header-copy">
          <span>步骤 {number}</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {action && <div className="section-header-action">{action}</div>}
      </div>
      <div className="section-body">{children}</div>
    </section>
  )
}

function FormField({
  className = '',
  label,
  hint,
  children,
}: {
  className?: string
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className={`form-field ${className}`}>
      <span className="field-title">{label}</span>
      <span className="field-hint">{hint}</span>
      {children}
    </div>
  )
}

function ChoiceCard({
  selected,
  skillId,
  onClick,
  icon,
  title,
  description,
  note,
}: {
  selected: boolean
  skillId?: PolicyInterpretationSkill
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  note: string
}) {
  return (
    <button
      className={`choice-card ${selected ? 'selected' : ''}`}
      type="button"
      data-skill-id={skillId}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="radio-mark">{selected && <span />}</span>
      <span className="choice-icon">{icon}</span>
      <span className="choice-copy">
        <strong>{title}</strong>
        <span>{description}</span>
        <small>{note}</small>
      </span>
    </button>
  )
}

export default App
