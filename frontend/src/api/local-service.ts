import {
  DEFECT_KEY,
  PATROL_KEY,
  compareDefects,
  deadlineTimestamp,
  handlerByName,
  isOpenDefect,
  normalizeLevel,
  toRectificationItem,
} from '@/data/defect'
import type { RectificationItem } from '@/data/defect'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  DispatchReceiptItem,
  DispatchResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

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
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
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

// ---- 缺陷处置：等级分档、批量转派、逐档推进 ----

// generic 只含业务字段的模糊检索条件；等级与状态由调用方单独精确过滤。
function filterDefects(rows: EntryRow[], generic: Record<string, string>, levelQuery: string, statusQuery: string): EntryRow[] {
  return filterRows(rows, generic).filter((row) => {
    if (levelQuery && normalizeLevel(row['缺陷等级']) !== normalizeLevel(levelQuery)) {
      return false
    }
    // status 是行内保留字段，不能走通用 includes 匹配，只允许按状态精确过滤。
    if (statusQuery && String(row.status) !== statusQuery) {
      return false
    }
    return true
  })
}

export function listDefects(filters: Record<string, string> = {}): PageResult {
  // 等级按缺陷口径精确匹配、状态按保留字段精确过滤；其余字段才走通用模糊检索。
  const levelQuery = String(filters['缺陷等级'] ?? '').trim()
  const statusQuery = String(filters.status ?? '').trim()
  const generic = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== '缺陷等级' && key !== 'status'),
  )
  const matched = filterDefects(listRows(DEFECT_KEY), generic, levelQuery, statusQuery).sort(compareDefects)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function allDefectRows(): EntryRow[] {
  return listRows(DEFECT_KEY)
}

function receiptBase(row: EntryRow): Omit<DispatchReceiptItem, 'code' | 'destination' | 'reason'> {
  return {
    id: Number(row.id),
    defectNo: String(row['缺陷编号'] ?? row.id),
    device: String(row['缺陷设备'] ?? ''),
    level: normalizeLevel(row['缺陷等级']) || '等级缺失',
    deadline: String(row['处理期限'] ?? '').trim() || '期限缺失',
  }
}

// 批量转派：勾选多条一次提交；等级/期限缺失、状态不符的逐条给出失败原因，不挡住整批。
export function dispatchDefects(ids: number[], handlerName: string): DispatchResult {
  const handler = handlerByName(handlerName.trim())
  if (!handler) {
    return {
      ok: false,
      message: '处理人不在缺陷处置名单内，请从名单中选择',
      items: [],
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
    }
  }

  const rows = allDefectRows()
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const items: DispatchReceiptItem[] = []
  const updated = new Map<number, EntryRow>()
  const uniqueIds = [...new Set(ids.map(Number))] // 同一条缺陷重复提交只出一行

  for (const id of uniqueIds) {
    const row = byId.get(id)
    if (!row) {
      items.push({
        id,
        code: 'failed',
        defectNo: `#${id}`,
        device: '',
        level: '—',
        deadline: '—',
        destination: '未转派',
        reason: '缺陷记录不存在或已被删除',
      })
      continue
    }

    const base = receiptBase(row)
    const level = normalizeLevel(row['缺陷等级'])
    const deadline = String(row['处理期限'] ?? '').trim()
    if (!level) {
      // 资料不齐的那几条挑出来单独成一栏，不参与本次提交，也不挡住其它条。
      const reason = !deadline || !Number.isFinite(deadlineTimestamp(deadline))
        ? '缺陷等级缺失、处理期限缺失'
        : '缺陷等级缺失'
      items.push({
        ...base,
        code: 'skipped',
        destination: '待补全资料',
        reason,
      })
      continue
    }
    if (!deadline || !Number.isFinite(deadlineTimestamp(deadline))) {
      items.push({
        ...base,
        code: 'skipped',
        destination: '待补全资料',
        reason: '处理期限缺失',
      })
      continue
    }

    const status = String(row.status)
    const currentHandler = String(row['处理人'] ?? '').trim()
    if (!isOpenDefect(row)) {
      items.push({
        ...base,
        code: 'failed',
        destination: currentHandler ? `原处理人 ${currentHandler}` : '未转派',
        reason: `当前状态「${status}」，不在可转派范围`,
      })
      continue
    }
    if (!handler.levels.includes(level)) {
      items.push({
        ...base,
        code: 'failed',
        destination: currentHandler ? `原处理人 ${currentHandler}` : '待指派',
        reason: `${handler.name}不承接${level}，请改选对应等级的处理人`,
      })
      continue
    }

    const destination = `${handler.name}（${handler.team}）`
    if (currentHandler === handler.name) {
      // 幂等：已派给同一处理人，结论照旧，不新增处理记录行。
      items.push({
        ...base,
        code: 'success',
        destination,
        reason: '处理人已是该人员，无需重复转派',
      })
      continue
    }

    const next: EntryRow = { ...row, 处理人: handler.name }
    if (status === '待处理') {
      // 转派即认领，缺陷由待处理推进到处理中，后续只能逐档推进。
      next.status = '处理中'
      next['缺陷状态'] = '处理中'
    }
    updated.set(id, next)
    items.push({
      ...base,
      code: 'success',
      destination,
      reason: status === '待处理' ? '已转派并认领，状态推进为处理中' : '已转派，沿用处理中状态',
    })
  }

  if (updated.size > 0) {
    saveRows(
      DEFECT_KEY,
      rows.map((row) => updated.get(Number(row.id)) ?? row),
    )
  }

  const successCount = items.filter((item) => item.code === 'success').length
  const failedCount = items.filter((item) => item.code === 'failed').length
  const skippedCount = items.filter((item) => item.code === 'skipped').length
  const parts: string[] = [`已转派 ${successCount} 条`]
  if (failedCount > 0) {
    parts.push(`失败 ${failedCount} 条`)
  }
  if (skippedCount > 0) {
    parts.push(`资料不齐 ${skippedCount} 条未提交`)
  }
  return {
    ok: successCount > 0,
    message:
      successCount > 0
        ? parts.join('，')
        : failedCount > 0
          ? `本批没有转派成功的缺陷：失败 ${failedCount} 条${skippedCount > 0 ? `，资料不齐 ${skippedCount} 条未提交` : ''}`
          : `本批 ${skippedCount} 条资料不齐，请补全缺陷等级与处理期限后再转派`,
    items,
    successCount,
    failedCount,
    skippedCount,
  }
}

// 转派后按 待处理 → 处理中 → 已消除 逐档推进，跳级直接挡回。
export function advanceDefect(id: number, action: string): ActionResult {
  const rows = allDefectRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  const row = rows[index]
  const status = String(row.status)
  if (status === '已升级') {
    return { ok: false, message: '缺陷已上报升级，需在升级流程中处置，不能直接确认消除' }
  }
  if (status === '已消除') {
    return { ok: false, message: `缺陷已是「已消除」，不能再${action}，请勿重复处置` }
  }
  if (action === '确认消除' && status !== '处理中') {
    return { ok: false, message: '缺陷尚在待处理，需先转派提交处理，不能跳级确认消除' }
  }
  if (action === '提交处理' && status !== '待处理') {
    return { ok: false, message: '缺陷已在处理中，转派即认领，无需重复提交' }
  }
  if (status === '待处理' && String(row['处理人'] ?? '').trim() === '') {
    return { ok: false, message: '尚未指派处理人，请先批量转派后再提交处理' }
  }
  const step = status === '待处理' ? '处理中' : '已消除'
  const next: EntryRow = {
    ...row,
    status: step,
    缺陷状态: step,
    pending: step !== '已消除',
    abnormal: false,
  }
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(DEFECT_KEY, nextRows)
  return { ok: true, message: `缺陷已${action}，当前状态「${step}」` }
}

// 上报升级只允许从处理中发起；待处理直接升级、已消除再升级都算跳级，挡回。
export function escalateDefect(id: number): ActionResult {
  const rows = allDefectRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的缺陷记录` }
  }
  const status = String(rows[index].status)
  if (status === '已升级') {
    return { ok: false, message: '缺陷已上报升级，不用重复操作' }
  }
  if (status === '已消除') {
    return { ok: false, message: '缺陷已消除，不能再上报升级' }
  }
  if (status === '待处理') {
    return { ok: false, message: '缺陷尚未转派处理，不能跳过处理中直接升级' }
  }
  const next: EntryRow = { ...rows[index], status: '已升级', 缺陷状态: '已升级' }
  const nextRows = [...rows]
  nextRows[index] = next
  saveRows(DEFECT_KEY, nextRows)
  return { ok: true, message: '缺陷已上报升级，等待升级流程处置' }
}

// 转派完成的结论反映到设备巡视的待整改清单：未消除的开放缺陷按巡视站点归集。
export function listRectifications(): RectificationItem[] {
  const openDefects = listRows(DEFECT_KEY).filter(isOpenDefect).sort(compareDefects)
  const patrolStations = listRows(PATROL_KEY).map((row) => String(row['巡视变电站'] ?? '').trim())
  return openDefects.map((defect) => {
    const device = String(defect['缺陷设备'] ?? '')
    const station = patrolStations.find((name) => name && device.includes(name)) ?? '未关联巡视记录'
    return toRectificationItem(defect, station)
  })
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
