import { SEED_ROWS, SEED_VERSION } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'
const VERSION_KEY = 'substation-protection:version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function writeStorage(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
    window.localStorage.setItem(VERSION_KEY, String(SEED_VERSION))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const version = window.localStorage.getItem(VERSION_KEY)
  if (!raw || version !== String(SEED_VERSION)) {
    // 示例口径（缺陷等级、处理期限等）随版本更新，旧数据整体回到新示例。
    window.localStorage.removeItem(VERSION_KEY)
    writeStorage(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    writeStorage(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
