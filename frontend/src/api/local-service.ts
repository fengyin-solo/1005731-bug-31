import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReassignResult,
  ReassignSplit,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 逐级推进的流转约束：缺陷处置必须 待处理→处理中→已消除 一步步走，跳级的在这里挡回。
const TRANSITION_GUARDS: Record<string, Record<string, string[]>> = {
  defect: {
    提交处理: ['待处理'],
    确认消除: ['处理中'],
    上报升级: ['待处理', '处理中'],
  },
}

// 各模块的终态：走到这些状态就不算待处理了。缺省取状态列表最后一项。
const TERMINAL_STATUSES: Record<string, string[]> = {
  defect: ['已消除', '已升级'],
}

// 缺陷等级沿用既有缺陷口径：危急 > 严重 > 一般。名单、分档排序与导出记录读的都是「缺陷等级」这同一个字段。
const DEFECT_LEVEL_RANK: Record<string, number> = { 危急: 0, 严重: 1, 一般: 2 }

// 处理人名单：批量转派时从这里选，不再手填。
export const DEFECT_HANDLERS = [
  '检修一班·王磊',
  '检修一班·李敏',
  '检修二班·赵强',
  '检修二班·陈晨',
  '试验班·刘洋',
]

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const allowedFrom = TRANSITION_GUARDS[key]?.[action]
  if (allowedFrom && !allowedFrom.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」，「${action}」须由「${allowedFrom.join('」「')}」推进，跳级已挡回`,
    }
  }
  const terminal = TERMINAL_STATUSES[key] ?? [meta.statuses[meta.statuses.length - 1]]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminal.includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 镜像字段同步：「缺陷状态」这类与状态同口径的字段跟着当前状态一起换，名单与导出读到的才是同一份。
  for (const field of meta.fields) {
    if (field.endsWith('状态') && updated[field] === current) {
      updated[field] = target
    }
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return listRows(key).find((row) => Number(row.id) === id)
}

export function listEntriesByIds(key: string, ids: number[]): EntryRow[] {
  const wanted = new Set(ids.map(Number))
  return listRows(key).filter((row) => wanted.has(Number(row.id)))
}

function defectLevelRank(row: EntryRow): number {
  return DEFECT_LEVEL_RANK[String(row['缺陷等级'] ?? '').trim()] ?? Object.keys(DEFECT_LEVEL_RANK).length
}

function defectDeadlineKey(row: EntryRow): string {
  const deadline = String(row['处理期限'] ?? '').trim()
  return deadline === '' ? '9999-12-31' : deadline
}

// 处置顺序：先按缺陷等级分档（危急>严重>一般>未分级），同档再按处理期限先后。
export function sortDefectsForDisposal(rows: EntryRow[]): EntryRow[] {
  return [...rows].sort(
    (a, b) =>
      defectLevelRank(a) - defectLevelRank(b) ||
      defectDeadlineKey(a).localeCompare(defectDeadlineKey(b)) ||
      Number(a.id) - Number(b.id),
  )
}

function missingDefectFields(row: EntryRow): string[] {
  const missing: string[] = []
  if (String(row['缺陷等级'] ?? '').trim() === '') {
    missing.push('缺陷等级')
  }
  if (String(row['处理期限'] ?? '').trim() === '') {
    missing.push('处理期限')
  }
  return missing
}

// 缺缺陷等级或处理期限的挑出来单独成栏：它们不随本批提交，也不挡住整批。
export function splitReassignable(rows: EntryRow[]): ReassignSplit {
  const ready: EntryRow[] = []
  const incomplete: { row: EntryRow; missing: string[] }[] = []
  for (const row of rows) {
    const missing = missingDefectFields(row)
    if (missing.length > 0) {
      incomplete.push({ row, missing })
    } else {
      ready.push(row)
    }
  }
  return { ready, incomplete }
}

// 批量转派：一次提交整批，逐条给出去向与失败原因；同一条缺陷重复提交只更新原行，不会多出第二行。
export function reassignDefects(ids: number[], handler: string): ReassignResult {
  const target = handler.trim()
  const rows = listRows('defect')
  const next = [...rows]
  const receipts: ReassignResult['receipts'] = []
  for (const id of [...new Set(ids)]) {
    const index = next.findIndex((row) => Number(row.id) === id)
    const code = index >= 0 ? String(next[index]['缺陷编号'] ?? id) : String(id)
    const fail = (reason: string) => receipts.push({ id, code, ok: false, destination: target, reason })
    if (target === '') {
      fail('未指定处理人')
      continue
    }
    if (index < 0) {
      fail('没有找到该缺陷记录')
      continue
    }
    const row = next[index]
    const missing = missingDefectFields(row)
    if (missing.length > 0) {
      fail(`缺${missing.join('、')}，补全后再派`)
      continue
    }
    const status = String(row.status)
    if (status === '已消除') {
      fail('缺陷已消除，无需转派')
      continue
    }
    if (status === '已升级') {
      fail('缺陷已升级，转由升级流程处置')
      continue
    }
    if (String(row['处理人'] ?? '').trim() === target) {
      fail('已是该处理人，重复提交已忽略')
      continue
    }
    next[index] = { ...row, 处理人: target }
    receipts.push({ id, code, ok: true, destination: target, reason: '' })
  }
  saveRows('defect', next)
  return { receipts }
}

// 设备巡视的待整改清单：未消除的缺陷都列进来，转派后的处理人与状态同步反映在这里。
export function listPendingRectifications(): EntryRow[] {
  return sortDefectsForDisposal(listRows('defect').filter((row) => String(row.status) !== '已消除'))
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
