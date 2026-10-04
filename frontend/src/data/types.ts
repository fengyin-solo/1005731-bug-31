/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 批量转派逐条回执：success=已转派，failed=校验通过但业务挡回，skipped=资料不齐未提交
export type ReceiptCode = 'success' | 'failed' | 'skipped'

export type DispatchReceiptItem = {
  id: number
  code: ReceiptCode
  defectNo: string
  device: string
  level: string
  deadline: string
  destination: string
  reason: string
}

export type DispatchResult = {
  ok: boolean
  message: string
  items: DispatchReceiptItem[]
  successCount: number
  failedCount: number
  skippedCount: number
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
