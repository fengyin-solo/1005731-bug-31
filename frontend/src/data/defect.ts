import type { EntryRow } from './types'

// 缺陷等级沿用既有缺陷口径：危急缺陷 / 严重缺陷 / 一般缺陷，名单与导出记录都按这三个词。
export const DEFECT_LEVELS = ['危急缺陷', '严重缺陷', '一般缺陷'] as const

export type DefectLevel = (typeof DEFECT_LEVELS)[number]

export type Handler = {
  name: string
  team: string
  levels: DefectLevel[]
}

// 处理人单一名单：缺陷列表的转派弹窗与明细面板读同一份，等级口径与导出记录一致。
export const HANDLER_ROSTER: Handler[] = [
  { name: '周卫东', team: '二次检修班', levels: ['危急缺陷', '严重缺陷', '一般缺陷'] },
  { name: '陈志强', team: '二次检修班', levels: ['危急缺陷', '严重缺陷'] },
  { name: '刘建华', team: '保护校验班', levels: ['严重缺陷', '一般缺陷'] },
  { name: '赵敏', team: '保护校验班', levels: ['一般缺陷'] },
  { name: '孙磊', team: '运维一班', levels: ['一般缺陷'] },
]

export const DEFECT_KEY = 'defect'
export const PATROL_KEY = 'patrol'

export function handlerByName(name: string): Handler | undefined {
  return HANDLER_ROSTER.find((item) => item.name === name)
}

export function handlerText(name: unknown): string {
  const text = String(name ?? '').trim()
  if (!text) {
    return '待指派'
  }
  const hit = handlerByName(text)
  return hit ? `${hit.name}（${hit.team}）` : text
}

export function normalizeLevel(value: unknown): DefectLevel | '' {
  const text = String(value ?? '').trim()
  const hit = DEFECT_LEVELS.find((level) => level === text)
  if (hit) {
    return hit
  }
  // 容忍「危急 / 严重 / 一般」这类简写，统一回既有完整口径。
  if (text === '危急') {
    return '危急缺陷'
  }
  if (text === '严重') {
    return '严重缺陷'
  }
  if (text === '一般' || text === '普通') {
    return '一般缺陷'
  }
  return ''
}

export function levelRank(value: unknown): number {
  const level = normalizeLevel(value)
  if (level === '危急缺陷') {
    return 0
  }
  if (level === '严重缺陷') {
    return 1
  }
  if (level === '一般缺陷') {
    return 2
  }
  return 3
}

export function deadlineTimestamp(value: unknown): number {
  const text = String(value ?? '').trim()
  if (!text) {
    return Number.POSITIVE_INFINITY
  }
  const time = new Date(text.replace(/[./]/g, '-')).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}

// 缺陷按等级分档、档内按处理期限先后处置；缺等级或缺期限的排到最后，不挡住整批。
export function compareDefects(a: EntryRow, b: EntryRow): number {
  const rankGap = levelRank(a['缺陷等级']) - levelRank(b['缺陷等级'])
  if (rankGap !== 0) {
    return rankGap
  }
  const deadlineGap = deadlineTimestamp(a['处理期限']) - deadlineTimestamp(b['处理期限'])
  if (deadlineGap !== 0) {
    return deadlineGap
  }
  return Number(a.id) - Number(b.id)
}

// 转派后按 待处理 → 处理中 → 已消除 推进，已升级是旁支，不参与主链路跳级。
export const DEFECT_FLOW = ['待处理', '处理中', '已消除'] as const
export const DEFECT_STATUS_OPEN = ['待处理', '处理中'] as const

export function isOpenDefect(row: EntryRow): boolean {
  return (DEFECT_STATUS_OPEN as readonly string[]).includes(String(row.status))
}

export type RectificationItem = {
  id: number
  defectNo: string
  device: string
  level: string
  deadline: string
  handler: string
  status: string
  sourcePatrol: string
  overdue: boolean
}

// 转派完成的结论反映到设备巡视的待整改清单：清单由缺陷数据派生，缺陷消除后自动移出。
export function toRectificationItem(row: EntryRow, patrolStation: string): RectificationItem {
  const deadline = String(row['处理期限'] ?? '').trim()
  const time = deadlineTimestamp(deadline)
  return {
    id: Number(row.id),
    defectNo: String(row['缺陷编号'] ?? ''),
    device: String(row['缺陷设备'] ?? ''),
    level: normalizeLevel(row['缺陷等级']) || '等级缺失',
    deadline: deadline || '期限缺失',
    handler: String(row['处理人'] ?? '').trim() || '待指派',
    status: String(row.status ?? ''),
    sourcePatrol: patrolStation,
    overdue: Number.isFinite(time) ? time < Date.now() : false,
  }
}
