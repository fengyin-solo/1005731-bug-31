<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷处置管理</h2>
        <p class="page-desc">缺陷按等级分档（危急缺陷 / 严重缺陷 / 一般缺陷）、按处理期限先后处置；支持勾选多条批量转派，转派后按待处理、处理中、已消除逐档推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷处置清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>缺陷编号</span>
        <input v-model="filters['缺陷编号']" placeholder="按缺陷编号检索" />
      </label>
      <label class="filter-item">
        <span>缺陷设备</span>
        <input v-model="filters['缺陷设备']" placeholder="按缺陷设备检索" />
      </label>
      <label class="filter-item">
        <span>缺陷等级</span>
        <select v-model="filters['缺陷等级']">
          <option value="">全部等级</option>
          <option v-for="level in DEFECT_LEVELS" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>当前状态</span>
        <select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="selectedIds.size > 0" class="batch-bar">
      <span>已勾选 <strong>{{ selectedIds.size }}</strong> 条缺陷，勾选结果跨筛选条件保留</span>
      <button class="btn primary" type="button" @click="openDispatch">批量转派（{{ selectedIds.size }}）</button>
      <button class="btn ghost" type="button" @click="clearSelection">清空勾选</button>
    </div>

    <table class="data-table defect-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allVisibleChecked"
              :indeterminate="someVisibleChecked && !allVisibleChecked"
              :disabled="visibleSelectableIds.length === 0"
              @change="toggleVisible"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in groupedRows" :key="group.key">
          <tr class="tier-row">
            <td :colspan="columns.length + 3">
              <span class="tier-tag" :class="group.badge">{{ group.label }}</span>
              {{ group.rows.length }} 条，按处理期限先后排列
            </td>
          </tr>
          <tr v-for="row in group.rows" :key="String(row.id)" :class="{ 'row-checked': selectedIds.has(Number(row.id)) }">
            <td class="col-check">
              <input
                type="checkbox"
                :checked="selectedIds.has(Number(row.id))"
                :disabled="!isOpen(row)"
                @change="toggleOne(row, $event)"
              />
            </td>
            <td><button class="link" type="button" @click="openDrawer(row)">{{ row['缺陷编号'] }}</button></td>
            <td>{{ row['缺陷设备'] }}</td>
            <td>
              <span class="level-badge" :class="levelClass(row)">{{ levelText(row) }}</span>
            </td>
            <td class="cell-desc">{{ row['缺陷描述'] || '—' }}</td>
            <td>{{ row['发现人'] || '—' }}</td>
            <td>
              <span :class="{ 'overdue-text': isOverdue(row) }">{{ deadlineText(row) }}</span>
              <span v-if="isOverdue(row)" class="overdue-flag">已逾期</span>
            </td>
            <td>{{ handlerText(row['处理人']) }}</td>
            <td><span class="status-badge" :class="statusClass(row)">{{ row.status }}</span></td>
            <td class="row-actions">
              <template v-if="rowActions(row).length">
                <button
                  v-for="action in rowActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runRowAction(action, row)"
                >
                  {{ action }}
                </button>
              </template>
              <span v-else class="muted-text">—</span>
              <button class="link" type="button" @click="openDrawer(row)">明细</button>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷记录；等级或处理期限缺失的条目不参与批量转派，需先补全资料</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 批量转派：确认与回执同窗切换 -->
    <div v-if="dispatchOpen" class="modal-mask" @click.self="closeDispatch">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="批量转派缺陷">
        <header class="modal-head">
          <h3>{{ dispatchResult ? '批量转派回执' : '批量转派缺陷' }}</h3>
          <button class="link" type="button" @click="closeDispatch">关闭</button>
        </header>

        <!-- 确认栏：可转派与资料不齐各成一栏，资料不齐不挡住整批 -->
        <div v-if="!dispatchResult" class="modal-body">
          <p class="dispatch-tip">
            本次勾选 {{ dispatchSnapshot.length }} 条：可转派
            <strong class="ok-text">{{ dispatchEligible.length }}</strong> 条，资料不齐或状态不符
            <strong class="warn-text">{{ dispatchIncomplete.length }}</strong> 条本次不提交，不挡住整批。
          </p>
          <label class="filter-item dispatch-handler">
            <span>统一指派处理人（名单与明细面板共用同一份，等级口径与导出记录一致）</span>
            <select v-model="dispatchHandler">
              <option value="" disabled>请选择处理人</option>
              <option v-for="person in handlers" :key="person.name" :value="person.name">
                {{ person.name }}（{{ person.team }}）· 承接：{{ person.levels.join('、') }}
              </option>
            </select>
          </label>
          <p v-if="uncoveredLevels.length" class="dispatch-warn">
            {{ selectedHandler?.name }} 不承接{{ uncoveredLevels.join('、') }}，相关条目提交后会在回执中逐条挡回，不影响其余条目转派。
          </p>

          <div class="dispatch-columns">
            <section class="dispatch-col">
              <h4 class="col-title ok-text">本批转派清单（{{ dispatchEligible.length }}）</h4>
              <table class="data-table compact">
                <thead>
                  <tr><th>缺陷编号</th><th>等级</th><th>处理期限</th><th>当前状态</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in dispatchEligible" :key="String(row.id)">
                    <td>{{ row['缺陷编号'] }}</td>
                    <td><span class="level-badge" :class="levelClass(row)">{{ levelText(row) }}</span></td>
                    <td>{{ deadlineText(row) }}</td>
                    <td>{{ row.status }}</td>
                  </tr>
                  <tr v-if="!dispatchEligible.length">
                    <td colspan="4" class="empty-state">勾选条目中没有可直接转派的缺陷</td>
                  </tr>
                </tbody>
              </table>
            </section>
            <section class="dispatch-col">
              <h4 class="col-title warn-text">资料不齐或状态不符，本次不提交（{{ dispatchIncomplete.length }}）</h4>
              <table class="data-table compact">
                <thead>
                  <tr><th>缺陷编号</th><th>缺陷设备</th><th>当前状态</th><th>未提交原因</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in dispatchIncomplete" :key="String(row.id)">
                    <td>{{ row['缺陷编号'] }}</td>
                    <td>{{ row['缺陷设备'] }}</td>
                    <td>{{ row.status }}</td>
                    <td class="warn-text">{{ incompleteReason(row) }}</td>
                  </tr>
                  <tr v-if="!dispatchIncomplete.length">
                    <td colspan="4" class="empty-state">勾选条目均符合转派条件</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>

        <!-- 回执栏：逐条给出去向与失败原因 -->
        <div v-else class="modal-body">
          <p class="dispatch-tip" :class="dispatchResult.ok ? 'ok-text' : 'error-text'">{{ dispatchResult.message }}</p>
          <section v-if="receiptGroup('success').length" class="receipt-section">
            <h4 class="col-title ok-text">转派成功（{{ receiptGroup('success').length }}）</h4>
            <table class="data-table compact">
              <thead><tr><th>缺陷编号</th><th>等级</th><th>去向</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="item in receiptGroup('success')" :key="String(item.id)">
                  <td>{{ item.defectNo }}</td>
                  <td><span class="level-badge" :class="badgeOf(item.level)">{{ item.level }}</span></td>
                  <td>{{ item.destination }}</td>
                  <td>{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section v-if="receiptGroup('failed').length" class="receipt-section">
            <h4 class="col-title error-text">转派失败（{{ receiptGroup('failed').length }}）</h4>
            <table class="data-table compact">
              <thead><tr><th>缺陷编号</th><th>等级</th><th>去向</th><th>失败原因</th></tr></thead>
              <tbody>
                <tr v-for="item in receiptGroup('failed')" :key="String(item.id)">
                  <td>{{ item.defectNo }}</td>
                  <td><span class="level-badge" :class="badgeOf(item.level)">{{ item.level }}</span></td>
                  <td>{{ item.destination }}</td>
                  <td class="error-text">{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section v-if="receiptGroup('skipped').length" class="receipt-section">
            <h4 class="col-title warn-text">未提交（{{ receiptGroup('skipped').length }}）</h4>
            <table class="data-table compact">
              <thead><tr><th>缺陷编号</th><th>等级</th><th>处理期限</th><th>未提交原因</th></tr></thead>
              <tbody>
                <tr v-for="item in receiptGroup('skipped')" :key="String(item.id)">
                  <td>{{ item.defectNo }}</td>
                  <td><span class="level-badge" :class="badgeOf(item.level)">{{ item.level }}</span></td>
                  <td>{{ item.deadline }}</td>
                  <td class="warn-text">{{ item.reason }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <footer class="modal-foot">
          <template v-if="!dispatchResult">
            <button class="btn ghost" type="button" @click="closeDispatch">取消</button>
            <button class="btn primary" type="button" :disabled="!dispatchHandler || dispatchEligible.length === 0" @click="confirmDispatch">
              确认转派{{ dispatchEligible.length ? `（${dispatchEligible.length} 条）` : '' }}
            </button>
          </template>
          <template v-else>
            <button class="btn" type="button" @click="backToConfirm">继续处置剩余条目</button>
            <button class="btn primary" type="button" @click="closeDispatch">完成</button>
          </template>
        </footer>
      </div>
    </div>

    <!-- 明细面板：处理人读的是与列表同一份名单 -->
    <div v-if="drawerRow" class="drawer-mask" @click.self="closeDrawer">
      <aside class="drawer" aria-label="缺陷明细">
        <header class="drawer-head">
          <h3>缺陷明细</h3>
          <button class="link" type="button" @click="closeDrawer">关闭</button>
        </header>
        <div class="drawer-body">
          <dl class="detail-list">
            <div><dt>缺陷编号</dt><dd>{{ drawerRow['缺陷编号'] }}</dd></div>
            <div><dt>缺陷设备</dt><dd>{{ drawerRow['缺陷设备'] }}</dd></div>
            <div>
              <dt>缺陷等级</dt>
              <dd><span class="level-badge" :class="levelClass(drawerRow)">{{ levelText(drawerRow) }}</span></dd>
            </div>
            <div><dt>缺陷描述</dt><dd>{{ drawerRow['缺陷描述'] || '—' }}</dd></div>
            <div><dt>发现人</dt><dd>{{ drawerRow['发现人'] || '—' }}</dd></div>
            <div>
              <dt>处理期限</dt>
              <dd>
                <span :class="{ 'overdue-text': isOverdue(drawerRow) }">{{ deadlineText(drawerRow) }}</span>
                <span v-if="isOverdue(drawerRow)" class="overdue-flag">已逾期</span>
              </dd>
            </div>
            <div><dt>当前状态</dt><dd><span class="status-badge" :class="statusClass(drawerRow)">{{ drawerRow.status }}</span></dd></div>
          </dl>

          <section class="handler-card">
            <h4>处理人（缺陷处置名单）</h4>
            <template v-if="drawerHandler">
              <p class="handler-name">{{ drawerHandler.name }}（{{ drawerHandler.team }}）</p>
              <p class="handler-levels">承接等级：{{ drawerHandler.levels.join('、') }}</p>
            </template>
            <p v-else-if="drawerRow['处理人']" class="handler-name">{{ drawerRow['处理人'] }}（不在当前名单）</p>
            <p v-else class="muted-text">待指派，请在缺陷列表勾选后批量转派</p>
          </section>

          <div v-if="drawerNote" class="drawer-note" :class="drawerNote.ok ? 'ok-text' : 'error-text'">
            {{ drawerNote.text }}
          </div>

          <div class="drawer-actions">
            <button v-for="action in rowActions(drawerRow)" :key="action" class="btn" type="button" @click="runDrawerAction(action)">
              {{ action }}
            </button>
            <span v-if="!rowActions(drawerRow).length" class="muted-text">当前状态无在线动作，如需处理请走升级或登记流程</span>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  advanceDefect,
  dispatchDefects,
  downloadEntries,
  escalateDefect,
  listDefects,
} from '@/api/local-service'
import {
  DEFECT_LEVELS,
  HANDLER_ROSTER,
  compareDefects,
  deadlineTimestamp,
  handlerByName,
  handlerText,
  isOpenDefect,
  normalizeLevel,
} from '@/data/defect'
import type { DispatchReceiptItem, DispatchResult, EntryRow, ReceiptCode } from '@/data/types'

const columns = ['缺陷编号', '缺陷设备', '缺陷等级', '缺陷描述', '发现人', '处理期限', '处理人']
const statuses = ['待处理', '处理中', '已消除', '已升级']
const handlers = HANDLER_ROSTER

const rows = ref<EntryRow[]>([])
const allRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ 缺陷编号: '', 缺陷设备: '', 缺陷等级: '', status: '' })

// 勾选状态独立于列表：换筛选条件、重新查询都不丢。
const selectedIds = ref<Set<number>>(new Set())

// ---- 分档展示：危急 / 严重 / 一般，等级缺失的单列一档排最后 ----
const groupedRows = computed(() => {
  const buckets = [
    { key: '危急缺陷', label: '危急缺陷档（优先处置）', badge: 'lv-critical', rows: [] as EntryRow[] },
    { key: '严重缺陷', label: '严重缺陷档', badge: 'lv-serious', rows: [] as EntryRow[] },
    { key: '一般缺陷', label: '一般缺陷档', badge: 'lv-general', rows: [] as EntryRow[] },
    { key: '__missing__', label: '等级待补录', badge: 'lv-missing', rows: [] as EntryRow[] },
  ]
  for (const row of rows.value) {
    const level = normalizeLevel(row['缺陷等级'])
    const index = level ? DEFECT_LEVELS.indexOf(level) : 3
    buckets[index].rows.push(row)
  }
  return buckets.filter((bucket) => bucket.rows.length > 0)
})

const stats = computed(() => [
  { label: '待处理缺陷', value: allRows.value.filter((row) => row.status === '待处理').length },
  { label: '处理中缺陷', value: allRows.value.filter((row) => row.status === '处理中').length },
  { label: '已消除缺陷', value: allRows.value.filter((row) => row.status === '已消除').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

// ---- 勾选 ----
const visibleSelectableIds = computed(() =>
  rows.value.filter((row) => isOpenDefect(row)).map((row) => Number(row.id)),
)
const allVisibleChecked = computed(
  () =>
    visibleSelectableIds.value.length > 0 &&
    visibleSelectableIds.value.every((id) => selectedIds.value.has(id)),
)
const someVisibleChecked = computed(() =>
  visibleSelectableIds.value.some((id) => selectedIds.value.has(id)),
)

function toggleOne(row: EntryRow, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(selectedIds.value)
  const id = Number(row.id)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  selectedIds.value = next
}

function toggleVisible(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(selectedIds.value)
  for (const id of visibleSelectableIds.value) {
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

// ---- 行内辅助 ----
function isOpen(row: EntryRow): boolean {
  return isOpenDefect(row)
}

function levelText(row: EntryRow): string {
  return normalizeLevel(row['缺陷等级']) || '等级缺失'
}

function levelClass(row: EntryRow): string {
  return badgeOf(levelText(row))
}

function badgeOf(level: string): string {
  if (level === '危急缺陷') {
    return 'lv-critical'
  }
  if (level === '严重缺陷') {
    return 'lv-serious'
  }
  if (level === '一般缺陷') {
    return 'lv-general'
  }
  return 'lv-missing'
}

function deadlineText(row: EntryRow): string {
  const text = String(row['处理期限'] ?? '').trim()
  return text || '期限缺失'
}

function isOverdue(row: EntryRow): boolean {
  if (!isOpenDefect(row)) {
    return false
  }
  const time = deadlineTimestamp(row['处理期限'])
  return Number.isFinite(time) ? time < Date.now() : false
}

function statusClass(row: EntryRow): string {
  const status = String(row.status)
  if (status === '待处理') {
    return 'st-pending'
  }
  if (status === '处理中') {
    return 'st-doing'
  }
  if (status === '已消除') {
    return 'st-done'
  }
  return 'st-up'
}

function rowActions(row: EntryRow): string[] {
  // 转派后只能逐档推进：待处理→提交处理，处理中→确认消除/上报升级，跳级动作不出现。
  const status = String(row.status)
  if (status === '待处理') {
    return ['提交处理']
  }
  if (status === '处理中') {
    return ['确认消除', '上报升级']
  }
  return []
}

function missingReason(row: EntryRow): string {
  const missing: string[] = []
  if (!normalizeLevel(row['缺陷等级'])) {
    missing.push('缺陷等级缺失')
  }
  if (!Number.isFinite(deadlineTimestamp(row['处理期限']))) {
    missing.push('处理期限缺失')
  }
  return missing.join('、')
}

function incompleteReason(row: EntryRow): string {
  const reason = missingReason(row)
  if (reason) {
    return reason
  }
  return `当前状态「${row.status}」，不在可转派范围`
}

// ---- 批量转派弹窗 ----
const dispatchOpen = ref(false)
const dispatchSnapshot = ref<EntryRow[]>([])
const dispatchHandler = ref('')
const dispatchResult = ref<DispatchResult | null>(null)

function isMissing(row: EntryRow): boolean {
  return (
    !normalizeLevel(row['缺陷等级']) ||
    !Number.isFinite(deadlineTimestamp(row['处理期限']))
  )
}

const dispatchEligible = computed(() =>
  dispatchSnapshot.value.filter((row) => !isMissing(row) && isOpenDefect(row)),
)
const dispatchIncomplete = computed(() =>
  dispatchSnapshot.value.filter((row) => isMissing(row) || !isOpenDefect(row)),
)
const selectedHandler = computed(() => handlerByName(dispatchHandler.value))
const uncoveredLevels = computed(() => {
  const handler = selectedHandler.value
  if (!handler) {
    return []
  }
  const levels = new Set<string>()
  for (const row of dispatchEligible.value) {
    const level = normalizeLevel(row['缺陷等级'])
    if (level && !handler.levels.includes(level)) {
      levels.add(level)
    }
  }
  return [...levels]
})

function openDispatch() {
  dispatchSnapshot.value = listDefects()
    .items.filter((row) => selectedIds.value.has(Number(row.id)))
    .sort(compareDefects)
  dispatchHandler.value = ''
  dispatchResult.value = null
  dispatchOpen.value = true
}

function closeDispatch() {
  dispatchOpen.value = false
  dispatchResult.value = null
  dispatchSnapshot.value = []
  dispatchHandler.value = ''
}

function confirmDispatch() {
  if (!dispatchHandler.value || dispatchEligible.value.length === 0) {
    return
  }
  // 只提交资料齐全且在开放状态的条目；资料不齐的那几条留在另一栏，不进回执、不挡批。
  const ids = dispatchEligible.value.map((row) => Number(row.id))
  const result = dispatchDefects(ids, dispatchHandler.value)
  dispatchResult.value = result
  // 成功条目移出勾选，失败的保留，便于换个处理人后再提。
  if (result.successCount > 0) {
    const next = new Set(selectedIds.value)
    for (const item of result.items) {
      if (item.code === 'success') {
        next.delete(item.id)
      }
    }
    selectedIds.value = next
  }
  errorMessage.value = ''
  reload()
}

function receiptGroup(code: ReceiptCode): DispatchReceiptItem[] {
  return dispatchResult.value?.items.filter((item) => item.code === code) ?? []
}

function backToConfirm() {
  dispatchResult.value = null
  dispatchSnapshot.value = listDefects().items.filter((row) =>
    selectedIds.value.has(Number(row.id)),
  )
}

// ---- 明细面板 ----
const drawerRowId = ref<number | null>(null)
const drawerNote = ref<{ text: string; ok: boolean } | null>(null)
const drawerRow = computed(() =>
  drawerRowId.value === null
    ? null
    : allRows.value.find((row) => Number(row.id) === drawerRowId.value) ?? null,
)
const drawerHandler = computed(() => {
  const name = String(drawerRow.value?.['处理人'] ?? '').trim()
  return name ? handlerByName(name) : undefined
})

function openDrawer(row: EntryRow) {
  drawerRowId.value = Number(row.id)
  drawerNote.value = null
}

function closeDrawer() {
  drawerRowId.value = null
  drawerNote.value = null
}

function runRowAction(action: string, row: EntryRow) {
  const result =
    action === '上报升级' ? escalateDefect(Number(row.id)) : advanceDefect(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
}

function runDrawerAction(action: string) {
  if (!drawerRow.value) {
    return
  }
  const result =
    action === '上报升级'
      ? escalateDefect(Number(drawerRow.value.id))
      : advanceDefect(Number(drawerRow.value.id), action)
  drawerNote.value = { text: result.message, ok: result.ok }
  if (result.ok) {
    reload()
  }
}

// ---- 列表 ----
function resetFilters() {
  filters.value = { 缺陷编号: '', 缺陷设备: '', 缺陷等级: '', status: '' }
  reload()
}

function exportRows() {
  downloadEntries('defect')
}

function openCreate() {
  errorMessage.value = '缺陷记录登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listDefects(filters.value)
    rows.value = payload.items
    total.value = payload.total
    allRows.value = listDefects().items
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷处置列表读取失败'
  }
}

onMounted(reload)
</script>
