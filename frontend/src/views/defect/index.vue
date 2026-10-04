<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷处置管理</h2>
        <p class="page-desc">维护缺陷记录，围绕缺陷编号、缺陷设备、缺陷等级、缺陷描述做登记、筛选与状态流转。</p>
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="selected-bar">
      <span>已选 {{ checkedIds.size }} 条（换筛选条件不会清空）</span>
      <button class="btn primary" type="button" :disabled="checkedIds.size === 0" @click="openReassign">
        批量转派
      </button>
      <button class="btn ghost" type="button" :disabled="checkedIds.size === 0" @click="clearSelection">
        清空选择
      </button>
      <span class="selected-hint">列表按缺陷等级分档、处理期限先后排列</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="check-col">
            <input type="checkbox" :checked="allVisibleChecked" @change="toggleAllVisible" />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="check-col">
            <input
              type="checkbox"
              :checked="checkedIds.has(Number(row.id))"
              @change="toggleCheck(Number(row.id), $event)"
            />
          </td>
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">明细</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无缺陷处置数据，可先登记缺陷记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷处置记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="drawer-mask" @click="closeDetail">
      <aside class="drawer" @click.stop>
        <header class="drawer-head">
          <h3>缺陷明细</h3>
          <button class="link" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="drawer-fields">
          <template v-for="column in columns" :key="column">
            <dt>{{ column }}</dt>
            <dd>{{ detail[column] || '—' }}</dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <p class="drawer-note">明细与缺陷列表读同一份数据，转派后两处同步更新。</p>
      </aside>
    </div>

    <div v-if="reassignOpen" class="modal-mask">
      <div class="modal">
        <h3>批量转派缺陷</h3>

        <template v-if="!receipts">
          <label class="handler-picker">
            <span>转派给（处理人）</span>
            <select v-model="handler">
              <option value="" disabled>请选择处理人</option>
              <option v-for="name in handlerRoster" :key="name" :value="name">{{ name }}</option>
            </select>
          </label>

          <section class="modal-section">
            <h4>本批提交（{{ readyRows.length }} 条，按等级分档、期限先后）</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>缺陷编号</th>
                  <th>缺陷设备</th>
                  <th>缺陷等级</th>
                  <th>处理期限</th>
                  <th>当前状态</th>
                  <th>现处理人</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in readyRows" :key="String(row.id)">
                  <td>{{ row['缺陷编号'] }}</td>
                  <td>{{ row['缺陷设备'] }}</td>
                  <td>{{ row['缺陷等级'] }}</td>
                  <td>{{ row['处理期限'] }}</td>
                  <td>{{ row.status }}</td>
                  <td>{{ row['处理人'] || '—' }}</td>
                </tr>
                <tr v-if="!readyRows.length">
                  <td colspan="6" class="empty-state">本批没有可提交的缺陷</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section v-if="incompleteRows.length" class="modal-section">
            <h4>信息待补全（{{ incompleteRows.length }} 条，不随本批提交，不挡住整批）</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>缺陷编号</th>
                  <th>缺陷设备</th>
                  <th>待补字段</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in incompleteRows" :key="String(item.row.id)">
                  <td>{{ item.row['缺陷编号'] }}</td>
                  <td>{{ item.row['缺陷设备'] }}</td>
                  <td class="error-text">缺{{ item.missing.join('、') }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <footer class="modal-foot">
            <button class="btn ghost" type="button" @click="closeReassign">取消</button>
            <button
              class="btn primary"
              type="button"
              :disabled="handler === '' || readyRows.length === 0"
              @click="confirmReassign"
            >
              确认转派 {{ readyRows.length }} 条
            </button>
          </footer>
        </template>

        <template v-else>
          <p class="receipt-summary">
            转派回执：成功 {{ okCount }} 条，未成 {{ failCount }} 条。
          </p>
          <table class="data-table">
            <thead>
              <tr>
                <th>缺陷编号</th>
                <th>去向</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="receipt in receipts" :key="receipt.id">
                <td>{{ receipt.code }}</td>
                <td>{{ receipt.destination || '—' }}</td>
                <td :class="receipt.ok ? 'receipt-ok' : 'error-text'">
                  {{ receipt.ok ? '转派成功' : receipt.reason }}
                </td>
              </tr>
            </tbody>
          </table>

          <section v-if="incompleteRows.length" class="modal-section">
            <h4>信息待补全（{{ incompleteRows.length }} 条，未随本批提交）</h4>
            <table class="data-table">
              <thead>
                <tr>
                  <th>缺陷编号</th>
                  <th>缺陷设备</th>
                  <th>待补字段</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in incompleteRows" :key="String(item.row.id)">
                  <td>{{ item.row['缺陷编号'] }}</td>
                  <td>{{ item.row['缺陷设备'] }}</td>
                  <td class="error-text">缺{{ item.missing.join('、') }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <footer class="modal-foot">
            <button class="btn primary" type="button" @click="closeReassign">完成</button>
          </footer>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  DEFECT_HANDLERS,
  downloadEntries,
  getEntry,
  listEntries,
  listEntriesByIds,
  moduleMeta,
  reassignDefects,
  runAction as applyAction,
  sortDefectsForDisposal,
  splitReassignable,
} from '@/api/local-service'
import type { EntryRow, ReassignReceipt } from '@/data/types'

const meta = moduleMeta('defect')
const columns = ["缺陷编号", "缺陷设备", "缺陷等级", "缺陷描述", "发现人", "处理期限", "处理人", "缺陷状态"]
const actions = ["提交处理", "确认消除", "上报升级"]
const statuses = ["待处理", "处理中", "已消除", "已升级"]
const stats = [{"label": "待处理缺陷", "value": 0}, {"label": "处理中缺陷", "value": 0}, {"label": "本月消除数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 勾选按缺陷 id 记，与当前筛选条件解耦：换一批条件再回来，选中的还在。
const checkedIds = ref<Set<number>>(new Set())
// 本地数据落库后递增，让依赖它的计算属性重取同一份数据。
const storeVersion = ref(0)

const handlerRoster = DEFECT_HANDLERS
const reassignOpen = ref(false)
const handler = ref('')
const receipts = ref<ReassignReceipt[] | null>(null)

const detailId = ref<number | null>(null)
const detail = ref<EntryRow | null>(null)

const selectedRows = computed(() => {
  storeVersion.value
  return sortDefectsForDisposal(listEntriesByIds(meta.key, [...checkedIds.value]))
})
const split = computed(() => splitReassignable(selectedRows.value))
const readyRows = computed(() => split.value.ready)
const incompleteRows = computed(() => split.value.incomplete)
const okCount = computed(() => (receipts.value ?? []).filter((receipt) => receipt.ok).length)
const failCount = computed(() => (receipts.value ?? []).filter((receipt) => !receipt.ok).length)
const allVisibleChecked = computed(
  () => rows.value.length > 0 && rows.value.every((row) => checkedIds.value.has(Number(row.id))),
)

function toggleCheck(id: number, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(checkedIds.value)
  if (checked) {
    next.add(id)
  } else {
    next.delete(id)
  }
  checkedIds.value = next
}

function toggleAllVisible(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const next = new Set(checkedIds.value)
  for (const row of rows.value) {
    const id = Number(row.id)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
  }
  checkedIds.value = next
}

function clearSelection() {
  checkedIds.value = new Set()
}

function openReassign() {
  handler.value = ''
  receipts.value = null
  reassignOpen.value = true
}

function closeReassign() {
  reassignOpen.value = false
  receipts.value = null
}

function confirmReassign() {
  const result = reassignDefects(readyRows.value.map((row) => Number(row.id)), handler.value)
  receipts.value = result.receipts
  // 已转派成功的移出勾选；未成的留着，方便补全信息或换处理人后重试。
  const done = new Set(result.receipts.filter((receipt) => receipt.ok).map((receipt) => receipt.id))
  checkedIds.value = new Set([...checkedIds.value].filter((id) => !done.has(id)))
  reload()
}

function openDetail(row: EntryRow) {
  detailId.value = Number(row.id)
  refreshDetail()
}

function refreshDetail() {
  detail.value = detailId.value === null ? null : getEntry(meta.key, detailId.value) ?? null
}

function closeDetail() {
  detailId.value = null
  detail.value = null
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '缺陷记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = sortDefectsForDisposal(payload.items)
    total.value = payload.total
    storeVersion.value += 1
    // 清掉已不在库里的勾选（比如数据被重置过）。
    const alive = new Set(listEntries(meta.key).items.map((row) => Number(row.id)))
    const pruned = new Set([...checkedIds.value].filter((id) => alive.has(id)))
    if (pruned.size !== checkedIds.value.size) {
      checkedIds.value = pruned
    }
    refreshDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '缺陷处置列表读取失败'
  }
}

onMounted(reload)
</script>
