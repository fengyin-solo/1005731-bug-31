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

/** 批量转派的逐条回执：每条缺陷给出去向与失败原因。 */
export type ReassignReceipt = {
  id: number
  code: string
  ok: boolean
  destination: string
  reason: string
}

export type ReassignResult = {
  receipts: ReassignReceipt[]
}

/** 勾选集合按可否随批提交拆开：缺字段的单独成栏，不挡住整批。 */
export type ReassignSplit = {
  ready: EntryRow[]
  incomplete: { row: EntryRow; missing: string[] }[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
