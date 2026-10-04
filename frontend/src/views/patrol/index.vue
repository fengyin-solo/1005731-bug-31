<template>
  <section class="page" data-module="patrol">
    <header class="page-head">
      <div>
        <h2>设备巡视管理</h2>
        <p class="page-desc">维护巡视记录，围绕巡视编号、巡视变电站、巡视路线、巡视人做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡视记录</button>
        <button class="btn" type="button" @click="exportRows">导出设备巡视清单</button>
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
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
          <td :colspan="columns.length + 2" class="empty-state">暂无设备巡视数据，可先登记巡视记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设备巡视记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="rectify-block">
      <header class="block-head">
        <h3>待整改清单</h3>
        <p class="page-desc">清单由缺陷处置结论自动汇集：待处理、处理中的缺陷按等级分档、处理期限先后列出；缺陷确认消除后自动移出。</p>
      </header>
      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">待整改缺陷</span>
          <strong class="stat-value">{{ rectifications.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已逾期</span>
          <strong class="stat-value overdue-text">{{ overdueCount }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">待处理</span>
          <strong class="stat-value">{{ countByStatus('待处理') }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">处理中</span>
          <strong class="stat-value">{{ countByStatus('处理中') }}</strong>
        </article>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>缺陷编号</th>
            <th>来源巡视站点</th>
            <th>缺陷设备</th>
            <th>缺陷等级</th>
            <th>处理期限</th>
            <th>处理人</th>
            <th>整改状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rectifications" :key="item.id">
            <td>{{ item.defectNo }}</td>
            <td>{{ item.sourcePatrol }}</td>
            <td>{{ item.device }}</td>
            <td><span class="level-badge" :class="badgeOf(item.level)">{{ item.level }}</span></td>
            <td>
              <span :class="{ 'overdue-text': item.overdue }">{{ item.deadline }}</span>
              <span v-if="item.overdue" class="overdue-flag">已逾期</span>
            </td>
            <td>{{ item.handler }}</td>
            <td><span class="status-badge" :class="badgeOfStatus(item.status)">{{ item.status }}</span></td>
          </tr>
          <tr v-if="!rectifications.length">
            <td colspan="7" class="empty-state">待整改清单为空，发现的缺陷均已消除</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listRectifications,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { RectificationItem } from '@/data/defect'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('patrol')
const columns = ["巡视编号", "巡视变电站", "巡视路线", "巡视人", "巡视日期", "发现缺陷数", "处理情况", "巡视状态"]
const actions = ["提交巡视", "确认完成", "上报问题"]
const statuses = ["待巡视", "巡视中", "已完成", "已上报"]
const stats = [{"label": "待巡视站点", "value": 0}, {"label": "已完成巡视", "value": 0}, {"label": "本月发现问题数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

// 待整改清单直接读缺陷处置结论，缺陷列表怎么转派、消除，这里就怎么变。
const rectifications = ref<RectificationItem[]>([])
const overdueCount = computed(() => rectifications.value.filter((item) => item.overdue).length)

function countByStatus(status: string): number {
  return rectifications.value.filter((item) => item.status === status).length
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

function badgeOfStatus(status: string): string {
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

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡视记录登记入口尚未接入审批流'
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
    rows.value = payload.items
    total.value = payload.total
    rectifications.value = listRectifications()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设备巡视列表读取失败'
  }
}

onMounted(reload)
</script>
