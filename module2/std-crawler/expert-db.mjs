// 企业内部专家库（案例7 标委会换届专家推荐）
// 演示数据：与《开发测试演示案例手册》案例7 的张XX/王XX/李XX 对齐，另补充 3 位覆盖更多技术领域
// 生产环境可对接 HR/专家系统（需求改造二-③「标委会信息与企业专家库解耦，真实对接时对接企业 HR/专家系统」）

export const DEFAULT_EXPERT_POOL = [
  {
    id: 'expert-001',
    name: '张XX',
    department: '标准化部',
    title: '高级工程师',            // 职称（副高）
    titleLevel: '副高级',
    workYears: 12,                 // 相关工作经验（年）
    professionalFields: ['冰箱制冷', '保鲜', '标准化'],
    stdExperience: '主导团体标准3项，参与国标2项',
    stdLeading: 3,                 // 主导标准数量
    stdParticipating: 2,           // 参与标准数量
    contact: { phone: '138XXXX1001', email: 'zhangxx@hisense.com', feishu: '张XX' },
    notes: '现任标委会委员，熟悉 GB/T 1.1 起草规则',
  },
  {
    id: 'expert-002',
    name: '王XX',
    department: '研发中心',
    title: '高级工程师',            // 职称（副高）
    titleLevel: '副高级',
    workYears: 9,
    professionalFields: ['冰箱结构', '能效', '无霜'],
    stdExperience: '参与行业标准1项',
    stdLeading: 0,
    stdParticipating: 1,
    contact: { phone: '138XXXX1002', email: 'wangxx@hisense.com', feishu: '王XX' },
    notes: '负责冰箱结构设计，能效项目负责人',
  },
  {
    id: 'expert-003',
    name: '李XX',
    department: '质量部',
    title: '工程师',                // 职称（中级）
    titleLevel: '中级',
    workYears: 6,
    professionalFields: ['冰箱检测', '保鲜性能试验'],
    stdExperience: '参与团体标准1项',
    stdLeading: 0,
    stdParticipating: 1,
    contact: { phone: '138XXXX1003', email: 'lixx@hisense.com', feishu: '李XX' },
    notes: '负责冰箱检测实验室，保鲜试验方法执行',
  },
  {
    id: 'expert-004',
    name: '陈XX',
    department: '研发中心',
    title: '教授级高级工程师',        // 职称（正高）
    titleLevel: '正高级',
    workYears: 18,
    professionalFields: ['微冻保鲜', '智能家电', '制冷系统'],
    stdExperience: '主导行业标准1项，参与国标3项',
    stdLeading: 1,
    stdParticipating: 3,
    contact: { phone: '138XXXX1004', email: 'chenxx@hisense.com', feishu: '陈XX' },
    notes: '公司技术专家委员会委员，承担多项省部级项目',
  },
  {
    id: 'expert-005',
    name: '刘XX',
    department: '家电研究院',
    title: '高级工程师',             // 职称（副高）
    titleLevel: '副高级',
    workYears: 11,
    professionalFields: ['家用电器', '保鲜技术', '食品保鲜'],
    stdExperience: '主导团体标准2项，参与行标2项',
    stdLeading: 2,
    stdParticipating: 2,
    contact: { phone: '138XXXX1005', email: 'liuxx@hisense.com', feishu: '刘XX' },
    notes: '食品保鲜技术方向带头人，与高校联合实验室合作',
  },
  {
    id: 'expert-006',
    name: '周XX',
    department: '制冷事业部',
    title: '工程师',                // 职称（中级）
    titleLevel: '中级',
    workYears: 5,
    professionalFields: ['制冷设备', '化霜控制', '制冰技术'],
    stdExperience: '参与行业标准1项',
    stdLeading: 0,
    stdParticipating: 1,
    contact: { phone: '138XXXX1006', email: 'zhouxx@hisense.com', feishu: '周XX' },
    notes: '制冷系统设计工程师，参与化霜控制项目',
  },
]

// 导出专家库（支持后续从外部配置覆盖）
export const loadExpertPool = (overrides = null) => {
  if (Array.isArray(overrides) && overrides.length > 0) return overrides
  return DEFAULT_EXPERT_POOL
}
