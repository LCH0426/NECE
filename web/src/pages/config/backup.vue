<script setup lang="ts">
import { DatabaseIcon, DownloadIcon, PlayIcon, RefreshCwIcon, SettingsIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IBackupItem } from '@/services/api/backup.api'

import { BasicPage } from '@/components/global-layout'
import { API_SERVER_URL } from '@/constants/app-config'
import { useBackupApi } from '@/services/api/backup.api'

const {
  getBackupConfig,
  updateBackupConfig,
  getBackupStats,
  getBackupList,
  getBackupStatus,
  executeBackup,
  deleteBackup,
  executeDataBackup,
  requestDownloadToken,
} = useBackupApi()

const activeTab = ref<'map' | 'data'>('map')

// ========== 地图备份相关 ==========
const loading = ref(true)
const stats = ref<{
  count: number
  totalSize: number
  totalSizeFormatted: string
  backups: IBackupItem[]
} | null>(null)
const worldBackups = ref<IBackupItem[]>([])
const dataBackups = ref<IBackupItem[]>([])

const isBackingUp = ref(false)
const backupRunning = ref(false)

const selectedFilenames = ref<Set<string>>(new Set())
const batchDeleteDialogOpen = ref(false)
const batchDeleteLoading = ref(false)

const currentBackups = computed(() => activeTab.value === 'map' ? worldBackups.value : dataBackups.value)

const isAllSelected = computed(() => {
  const backups = currentBackups.value
  return backups.length > 0 && backups.every(b => selectedFilenames.value.has(b.filename))
})
const isIndeterminate = computed(() => {
  const backups = currentBackups.value
  const selected = backups.filter(b => selectedFilenames.value.has(b.filename)).length
  return selected > 0 && selected < backups.length
})

function toggleSelectAll() {
  const backups = currentBackups.value
  if (isAllSelected.value) {
    selectedFilenames.value = new Set()
  }
  else {
    selectedFilenames.value = new Set(backups.map(b => b.filename))
  }
}

function toggleSelect(filename: string) {
  const s = new Set(selectedFilenames.value)
  if (s.has(filename))
    s.delete(filename)
  else s.add(filename)
  selectedFilenames.value = s
}

async function handleBatchDelete() {
  if (selectedFilenames.value.size === 0)
    return
  batchDeleteDialogOpen.value = true
}

const deleteProgress = ref(0)
const deleteTotal = ref(0)

async function confirmBatchDelete() {
  batchDeleteLoading.value = true
  deleteTotal.value = selectedFilenames.value.size
  deleteProgress.value = 0
  let success = 0
  let fail = 0
  for (const filename of selectedFilenames.value) {
    try {
      const res = await deleteBackup(filename)
      if (res.code === 200)
        success++
      else fail++
    }
    catch {
      fail++
    }
    deleteProgress.value++
  }
  batchDeleteLoading.value = false
  selectedFilenames.value = new Set()
  batchDeleteDialogOpen.value = false
  deleteProgress.value = 0
  if (fail === 0)
    toast.success(`批量删除成功 (${success}个)`)
  else toast.warning(`删除完成：成功${success}个，失败${fail}个`)
  fetchMapData()
}

async function fetchMapData() {
  loading.value = true
  try {
    const [statsRes, listRes, statusRes] = await Promise.all([
      getBackupStats(),
      getBackupList(),
      getBackupStatus(),
    ])
    if (statsRes.code === 200)
      stats.value = statsRes.data
    if (listRes.code === 200) {
      worldBackups.value = listRes.data.filter(b => b.type === 'world')
      dataBackups.value = listRes.data.filter(b => b.type === 'data')
    }
    if (statusRes.code === 200)
      backupRunning.value = statusRes.data.isRunning
  }
  catch {
    toast.error('获取备份信息失败')
  }
  finally {
    loading.value = false
  }
}

async function handleExecuteBackup() {
  if (backupRunning.value || isBackingUp.value)
    return
  isBackingUp.value = true
  backupRunning.value = true
  toast.info('备份已开始，请耐心等待...')
  try {
    const res = await executeBackup()
    if (res.code === 200) {
      const data = res.data
      const successCount = data.results.filter(r => r.success).length
      const failCount = data.results.filter(r => !r.success).length
      let msg = `备份完成！耗时 ${data.elapsed}s，总大小 ${data.totalSizeFormatted}`
      if (failCount > 0)
        msg += `，${successCount} 成功，${failCount} 失败`
      toast.success(msg)
      fetchMapData()
    }
    else {
      toast.error(res.msg || '备份失败')
    }
  }
  catch {
    toast.error('备份请求失败')
  }
  finally {
    isBackingUp.value = false
    backupRunning.value = false
  }
}

async function handleDownload(item: IBackupItem) {
  try {
    const res = await requestDownloadToken(item.filename)
    if (res.code === 200 && res.data?.downloadUrl) {
      const url = `${API_SERVER_URL}${res.data.downloadUrl}`
      const a = document.createElement('a')
      a.href = url
      a.download = item.filename
      a.click()
      toast.info(`正在下载 ${item.filename}...`)
    }
    else {
      toast.error(res.msg || '申请下载链接失败')
    }
  }
  catch {
    toast.error('申请下载链接失败')
  }
}

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IBackupItem | null>(null)
const deleteLoading = ref(false)

function openDeleteDialog(item: IBackupItem) {
  deleteTarget.value = item
  deleteDialogOpen.value = true
}

async function handleDelete() {
  if (!deleteTarget.value)
    return
  deleteLoading.value = true
  try {
    const res = await deleteBackup(deleteTarget.value.filename)
    if (res.code === 200) {
      toast.success('备份已删除')
      fetchMapData()
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteLoading.value = false
    deleteDialogOpen.value = false
  }
}

const configDialogOpen = ref(false)
const configLoading = ref(false)
const configSaving = ref(false)
const configForm = reactive({
  compressionLevel: 5,
  interval: 0,
  maxAgeDays: 0,
  maxCount: 0,
  dataBackupInterval: 0,
})

async function openConfigDialog() {
  configDialogOpen.value = true
  configLoading.value = true
  try {
    const res = await getBackupConfig()
    if (res.code === 200) {
      configForm.compressionLevel = res.data.compressionLevel
      configForm.interval = res.data.interval
      configForm.maxAgeDays = res.data.maxAgeDays
      configForm.maxCount = res.data.maxCount
      configForm.dataBackupInterval = res.data.dataBackupInterval || 0
    }
  }
  catch {
    toast.error('获取备份配置失败')
  }
  finally {
    configLoading.value = false
  }
}

async function handleSaveConfig() {
  configSaving.value = true
  try {
    const res = await updateBackupConfig({
      compressionLevel: configForm.compressionLevel,
      interval: configForm.interval,
      maxAgeDays: configForm.maxAgeDays,
      maxCount: configForm.maxCount,
      dataBackupInterval: configForm.dataBackupInterval,
    })
    if (res.code === 200) {
      toast.success('备份配置已保存')
      configDialogOpen.value = false
    }
    else {
      toast.error(res.msg || '保存配置失败')
    }
  }
  catch {
    toast.error('保存配置失败')
  }
  finally {
    configSaving.value = false
  }
}

// ========== 数据备份相关 ==========
const dataBackupLoading = ref(false)
const dataBackupResult = ref<{
  filename: string
  size: number
  duration: number
  time: string
} | null>(null)

async function handleDataBackup() {
  dataBackupLoading.value = true
  dataBackupResult.value = null
  try {
    const res = await executeDataBackup()
    if (res.code === 200) {
      dataBackupResult.value = res.data
      toast.success('数据备份完成')
      fetchMapData() // 立即刷新列表
    }
    else {
      toast.error(res.msg || '数据备份失败')
    }
  }
  catch {
    toast.error('数据备份失败')
  }
  finally {
    dataBackupLoading.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

onMounted(() => {
  fetchMapData()
})
</script>

<template>
  <BasicPage title="备份管理" description="管理服务器备份">
    <!-- Tab 切换 + 备份配置 -->
    <div class="flex items-center justify-between mb-4">
      <UiTabs v-model="activeTab">
        <UiTabsList>
          <UiTabsTrigger value="map">
            地图备份
          </UiTabsTrigger>
          <UiTabsTrigger value="data">
            数据备份
          </UiTabsTrigger>
        </UiTabsList>
      </UiTabs>
      <UiButton variant="outline" size="sm" @click="openConfigDialog">
        <SettingsIcon class="size-4 mr-1" />
        备份配置
      </UiButton>
    </div>

    <!-- 操作按钮 -->
    <div class="flex items-center gap-2 mb-4">
      <UiButton variant="outline" size="sm" @click="fetchMapData">
        <RefreshCwIcon class="size-4 mr-1" />
        刷新
      </UiButton>
      <div class="flex-1" />
      <UiButton
        v-if="selectedFilenames.size > 0"
        variant="outline"
        size="sm"
        @click="toggleSelectAll"
      >
        {{ isAllSelected ? '取消全选' : '全选' }}
      </UiButton>
      <UiButton
        v-if="selectedFilenames.size > 0"
        variant="destructive"
        size="sm"
        :disabled="batchDeleteLoading"
        @click="handleBatchDelete"
      >
        <TrashIcon class="size-4 mr-1" />
        批量删除 ({{ selectedFilenames.size }})
      </UiButton>
      <template v-if="activeTab === 'map'">
        <UiButton
          size="sm"
          :disabled="isBackingUp || backupRunning"
          @click="handleExecuteBackup"
        >
          <PlayIcon class="size-4 mr-1" />
          {{ isBackingUp || backupRunning ? '备份中...' : '立即备份' }}
        </UiButton>
      </template>
      <template v-else>
        <UiButton size="sm" :disabled="dataBackupLoading || isBackingUp || backupRunning" @click="handleDataBackup">
          <DatabaseIcon class="size-4 mr-1" />
          {{ dataBackupLoading ? '备份中...' : '执行数据备份' }}
        </UiButton>
      </template>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-12">
      <UiSpinner class="size-6" />
    </div>

    <div v-else class="space-y-4">
      <!-- 统计卡片 -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="border rounded-lg p-4">
          <div class="text-sm text-muted-foreground">
            备份数量
          </div>
          <div class="text-2xl font-bold mt-1">
            {{ activeTab === 'map' ? worldBackups.length : dataBackups.length }}
          </div>
        </div>
        <div class="border rounded-lg p-4">
          <div class="text-sm text-muted-foreground">
            总备份大小
          </div>
          <div class="text-2xl font-bold mt-1">
            {{ stats?.totalSizeFormatted ?? '0 B' }}
          </div>
        </div>
        <div class="border rounded-lg p-4">
          <div class="text-sm text-muted-foreground">
            备份状态
          </div>
          <div class="text-2xl font-bold mt-1" :class="backupRunning ? 'text-yellow-500' : 'text-green-600'">
            {{ backupRunning ? '备份中' : '空闲' }}
          </div>
        </div>
      </div>

      <!-- 数据备份结果提示 -->
      <div v-if="activeTab === 'data' && dataBackupResult" class="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
        <h4 class="font-medium text-green-800 dark:text-green-300 mb-2">
          备份完成
        </h4>
        <div class="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span class="text-muted-foreground">文件名：</span>
            <span class="font-mono">{{ dataBackupResult.filename }}</span>
          </div>
          <div>
            <span class="text-muted-foreground">大小：</span>
            <span>{{ formatSize(dataBackupResult.size) }}</span>
          </div>
          <div>
            <span class="text-muted-foreground">耗时：</span>
            <span>{{ dataBackupResult.duration }}秒</span>
          </div>
          <div>
            <span class="text-muted-foreground">时间：</span>
            <span>{{ dataBackupResult.time }}</span>
          </div>
        </div>
      </div>

      <!-- 备份列表 -->
      <div class="border rounded-lg">
        <div class="grid grid-cols-[40px_1fr_120px_120px_160px_80px] gap-4 px-4 py-3 border-b text-xs text-muted-foreground font-medium items-center">
          <UiCheckbox
            :model-value="isAllSelected || (isIndeterminate ? 'indeterminate' : false)"
            @update:model-value="toggleSelectAll"
          />
          <span>文件名</span>
          <span>{{ activeTab === 'map' ? '世界' : '类型' }}</span>
          <span>大小</span>
          <span>备份时间</span>
          <span>操作</span>
        </div>
        <div v-if="currentBackups.length === 0" class="p-4 text-center text-muted-foreground text-sm">
          {{ activeTab === 'map' ? '暂无世界备份' : '暂无数据备份' }}
        </div>
        <div
          v-for="item in currentBackups"
          :key="item.filename"
          class="grid grid-cols-[40px_1fr_120px_120px_160px_80px] gap-4 px-4 py-3 border-b last:border-b-0 hover:bg-muted/30 items-center"
        >
          <UiCheckbox
            :model-value="selectedFilenames.has(item.filename)"
            @update:model-value="toggleSelect(item.filename)"
          />
          <span class="text-sm font-mono truncate" :title="item.filename">{{ item.filename }}</span>
          <span class="text-sm text-muted-foreground">{{ item.world }}</span>
          <span class="text-sm">{{ item.sizeFormatted }}</span>
          <span class="text-sm text-muted-foreground">{{ item.timeFormatted }}</span>
          <div class="flex items-center gap-1">
            <UiButton variant="ghost" size="icon" class="size-8" title="下载" @click="handleDownload(item)">
              <DownloadIcon class="size-4" />
            </UiButton>
            <UiButton variant="ghost" size="icon" class="size-8 text-destructive" title="删除" @click="openDeleteDialog(item)">
              <TrashIcon class="size-4" />
            </UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 批量删除对话框 -->
    <UiDialog v-model:open="batchDeleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>批量删除备份</UiDialogTitle>
          <UiDialogDescription>
            确定要删除选中的 {{ selectedFilenames.size }} 个备份吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="batchDeleteLoading" class="py-4 space-y-2">
          <div class="flex items-center justify-between text-sm">
            <span>删除进度</span>
            <span>{{ deleteProgress }} / {{ deleteTotal }}</span>
          </div>
          <div class="w-full bg-muted rounded-full h-2">
            <div
              class="bg-primary h-2 rounded-full transition-all duration-300"
              :style="{ width: `${(deleteProgress / deleteTotal) * 100}%` }"
            />
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" :disabled="batchDeleteLoading" @click="batchDeleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="batchDeleteLoading" @click="confirmBatchDelete">
            {{ batchDeleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 备份配置对话框 -->
    <UiDialog v-model:open="configDialogOpen">
      <UiDialogContent class="sm:max-w-[500px]">
        <UiDialogHeader>
          <UiDialogTitle>备份配置</UiDialogTitle>
          <UiDialogDescription>
            配置自动备份策略和保留规则
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="configLoading" class="flex items-center justify-center py-8">
          <UiSpinner class="size-5" />
        </div>
        <div v-else class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">压缩等级</label>
            <UiInput v-model="configForm.compressionLevel" type="number" :min="0" :max="9" placeholder="5" />
            <p class="text-xs text-muted-foreground">
              0=无压缩（最快），9=最高压缩（最慢），推荐 3-5
            </p>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">世界备份间隔（小时）</label>
              <UiInput v-model="configForm.interval" type="number" :min="0" placeholder="0" />
              <p class="text-xs text-muted-foreground">
                设为 0 则禁用
              </p>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">数据备份间隔（小时）</label>
              <UiInput v-model="configForm.dataBackupInterval" type="number" :min="0" placeholder="0" />
              <p class="text-xs text-muted-foreground">
                设为 0 则禁用
              </p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">备份保留天数</label>
              <UiInput v-model="configForm.maxAgeDays" type="number" :min="0" placeholder="0" />
              <p class="text-xs text-muted-foreground">
                0=不限制
              </p>
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">备份保留数量上限</label>
              <UiInput v-model="configForm.maxCount" type="number" :min="0" placeholder="0" />
              <p class="text-xs text-muted-foreground">
                0=不限制
              </p>
            </div>
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="configDialogOpen = false">
            取消
          </UiButton>
          <UiButton :disabled="configSaving" @click="handleSaveConfig">
            {{ configSaving ? '保存中...' : '保存配置' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <!-- 删除确认对话框 -->
    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除备份</UiDialogTitle>
          <UiDialogDescription>
            确定要删除备份「{{ deleteTarget?.filename }}」吗？此操作不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteLoading" @click="handleDelete">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
