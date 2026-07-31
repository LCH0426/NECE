<script setup lang="ts">
import { ChevronRightIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { IGuildDetail, IGuildItem, IGuildTeleport } from '@/services/api/guild.api'

import { BasicPage } from '@/components/global-layout'
import { useGuildApi } from '@/services/api/guild.api'
import { usePlayerApi } from '@/services/api/player.api'

const {
  getGuildList,
  getGuildDetail,
  deleteGuild,
  updateGuild,
  updateGuildFund,
  addGuildTeleport,
  deleteGuildTeleport,
} = useGuildApi()
const { getPlayerNamesByXuids } = usePlayerApi()

const memberNameMap = ref<Map<string, string>>(new Map())

const guilds = ref<IGuildItem[]>([])
const loading = ref(true)
const searchQuery = ref('')

const filteredGuilds = computed(() => {
  if (!searchQuery.value.trim())
    return guilds.value
  const q = searchQuery.value.trim().toLowerCase()
  return guilds.value.filter(g =>
    g.name.toLowerCase().includes(q)
    || g.ownerName.toLowerCase().includes(q),
  )
})

async function fetchGuilds() {
  loading.value = true
  try {
    const res = await getGuildList()
    if (res.code === 200) {
      guilds.value = res.data
    }
  }
  catch {
    toast.error('获取公会列表失败')
  }
  finally {
    loading.value = false
  }
}

function handleSearch() {
  fetchGuilds()
}

function handleRefresh() {
  fetchGuilds()
  toast.success('已刷新公会列表')
}

const detailDialogOpen = ref(false)
const selectedGuild = ref<IGuildItem | null>(null)
const guildDetail = ref<IGuildDetail | null>(null)
const detailLoading = ref(false)

async function openDetailDialog(guild: IGuildItem) {
  selectedGuild.value = guild
  guildDetail.value = null
  memberNameMap.value = new Map()
  detailLoading.value = true
  detailDialogOpen.value = true
  try {
    const res = await getGuildDetail(guild.id)
    if (res.code === 200) {
      guildDetail.value = res.data
      const xuids = res.data.members.map(m => m.xuid)
      if (xuids.length > 0) {
        memberNameMap.value = await getPlayerNamesByXuids(xuids)
      }
    }
    else {
      toast.error(res.msg || '获取公会详情失败')
    }
  }
  catch {
    toast.error('获取公会详情失败')
  }
  finally {
    detailLoading.value = false
  }
}

const editDialogOpen = ref(false)
const editForm = reactive({
  name: '',
  description: '',
  level: 1,
  maxMembers: 20,
})
const editActionLoading = ref(false)
const editActionError = ref('')
const editActionResult = ref('')

function openEditDialog(guild: IGuildItem) {
  selectedGuild.value = guild
  editForm.name = guild.name
  editForm.description = guild.description
  editForm.level = guild.level
  editForm.maxMembers = guild.maxMembers
  editActionError.value = ''
  editActionResult.value = ''
  editDialogOpen.value = true
}

async function handleUpdateGuild() {
  if (!selectedGuild.value)
    return
  editActionLoading.value = true
  editActionError.value = ''
  try {
    const res = await updateGuild(selectedGuild.value.id, {
      name: editForm.name || undefined,
      description: editForm.description || undefined,
      level: editForm.level,
      maxMembers: editForm.maxMembers,
    })
    if (res.code === 200) {
      editActionResult.value = '公会信息已更新'
      toast.success('公会信息已更新')
      fetchGuilds()
    }
    else {
      editActionError.value = res.msg || '更新失败'
      toast.error(res.msg || '更新失败')
    }
  }
  catch {
    editActionError.value = '网络错误'
    toast.error('网络错误')
  }
  finally {
    editActionLoading.value = false
  }
}

const deleteDialogOpen = ref(false)
const deleteTarget = ref<IGuildItem | null>(null)
const deleteLoading = ref(false)

function openDeleteDialog(guild: IGuildItem) {
  deleteTarget.value = guild
  deleteDialogOpen.value = true
}

async function handleDeleteGuild() {
  if (!deleteTarget.value)
    return
  deleteLoading.value = true
  try {
    const res = await deleteGuild(deleteTarget.value.id)
    if (res.code === 200) {
      toast.success(`公会"${deleteTarget.value.name}"已删除`)
      deleteDialogOpen.value = false
      fetchGuilds()
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
  }
}

const fundDialogOpen = ref(false)
const fundTarget = ref<IGuildItem | null>(null)
const fundAmount = ref<number>(0)
const fundActionLoading = ref(false)
const fundActionError = ref('')

function openFundDialog(guild: IGuildItem) {
  fundTarget.value = guild
  fundAmount.value = guild.fund
  fundActionError.value = ''
  fundDialogOpen.value = true
}

async function handleUpdateFund() {
  if (!fundTarget.value)
    return
  if (fundAmount.value < 0) {
    fundActionError.value = '资金不能为负数'
    return
  }
  fundActionLoading.value = true
  fundActionError.value = ''
  try {
    const res = await updateGuildFund(fundTarget.value.id, fundAmount.value)
    if (res.code === 200) {
      toast.success('公会资金已更新')
      fundDialogOpen.value = false
      fetchGuilds()
    }
    else {
      fundActionError.value = res.msg || '更新失败'
    }
  }
  catch {
    fundActionError.value = '网络错误'
  }
  finally {
    fundActionLoading.value = false
  }
}

function formatTimestamp(ts: number): string {
  if (!ts)
    return '-'
  // 自动判断是秒级还是毫秒级时间戳
  const timestamp = ts < 10000000000 ? ts * 1000 : ts
  return new Date(timestamp).toLocaleString('zh-CN')
}

// 传送点管理
const addTpDialogOpen = ref(false)
const addTpTarget = ref<IGuildItem | null>(null)
const addTpForm = reactive({ name: '', x: 0, y: 0, z: 0, dim: '0' })
const addTpLoading = ref(false)
const addTpError = ref('')

function openAddTpDialog(guild: IGuildItem) {
  addTpTarget.value = guild
  addTpForm.name = ''
  addTpForm.x = 0
  addTpForm.y = 0
  addTpForm.z = 0
  addTpForm.dim = '0'
  addTpError.value = ''
  addTpDialogOpen.value = true
}

async function handleAddTeleport() {
  if (!addTpTarget.value)
    return
  if (!addTpForm.name.trim()) {
    addTpError.value = '请输入传送点名称'
    return
  }
  addTpLoading.value = true
  addTpError.value = ''
  try {
    const res = await addGuildTeleport(addTpTarget.value.id, {
      name: addTpForm.name.trim(),
      x: addTpForm.x,
      y: addTpForm.y,
      z: addTpForm.z,
      dim: addTpForm.dim,
    })
    if (res.code === 200) {
      toast.success('传送点已添加')
      addTpDialogOpen.value = false
      openDetailDialog(addTpTarget.value)
    }
    else {
      addTpError.value = res.msg || '添加失败'
    }
  }
  catch {
    addTpError.value = '网络错误'
  }
  finally {
    addTpLoading.value = false
  }
}

const deleteTpDialogOpen = ref(false)
const deleteTpTarget = ref<{ guildId: number, tp: IGuildTeleport } | null>(null)
const deleteTpLoading = ref(false)

function openDeleteTpDialog(guildId: number, tp: IGuildTeleport) {
  deleteTpTarget.value = { guildId, tp }
  deleteTpDialogOpen.value = true
}

async function handleDeleteTeleport() {
  if (!deleteTpTarget.value)
    return
  deleteTpLoading.value = true
  try {
    const res = await deleteGuildTeleport(deleteTpTarget.value.guildId, deleteTpTarget.value.tp.id)
    if (res.code === 200) {
      toast.success('传送点已删除')
      deleteTpDialogOpen.value = false
      if (selectedGuild.value)
        openDetailDialog(selectedGuild.value)
    }
    else {
      toast.error(res.msg || '删除失败')
    }
  }
  catch {
    toast.error('删除失败')
  }
  finally {
    deleteTpLoading.value = false
  }
}

onMounted(() => {
  fetchGuilds()
})
</script>

<template>
  <BasicPage title="公会管理" description="管理服务器公会" sticky>
    <template #actions>
      <div class="flex items-center gap-2">
        <UiButton variant="outline" size="sm" @click="handleRefresh">
          刷新
        </UiButton>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <UiInput
            v-model="searchQuery"
            placeholder="搜索公会名 / 会长名"
            class="w-[250px]"
            @keydown.enter="handleSearch"
          />
          <UiButton variant="outline" size="icon" @click="handleSearch">
            <SearchIcon class="size-4" />
          </UiButton>
        </div>
        <span class="text-sm text-muted-foreground">
          共 {{ filteredGuilds.length }} 个公会
        </span>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-12">
        <UiSpinner class="size-6" />
      </div>

      <div v-else-if="filteredGuilds.length === 0" class="flex items-center justify-center py-12 text-muted-foreground text-sm">
        暂无公会数据
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="guild in filteredGuilds"
          :key="guild.id"
          class="border rounded-lg p-4 hover:bg-muted/30 transition-colors space-y-3"
        >
          <div class="flex items-start justify-between">
            <div>
              <h3 class="text-base font-semibold">
                {{ guild.name }}
              </h3>
              <p class="text-xs text-muted-foreground mt-1">
                ID: {{ guild.id }} · Lv.{{ guild.level }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <UiButton variant="ghost" size="icon" class="size-8" @click="openEditDialog(guild)">
                <PencilIcon class="size-4" />
              </UiButton>
              <UiButton variant="ghost" size="icon" class="size-8 text-destructive" @click="openDeleteDialog(guild)">
                <TrashIcon class="size-4" />
              </UiButton>
            </div>
          </div>

          <p class="text-sm text-muted-foreground line-clamp-2">
            {{ guild.description || '暂无描述' }}
          </p>

          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span class="text-muted-foreground">会长: </span>
              <span class="font-medium">{{ guild.ownerName }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">成员: </span>
              <span class="font-medium">{{ guild.memberCount }}/{{ guild.maxMembers }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">资金: </span>
              <span class="font-medium font-mono cursor-pointer hover:text-primary" @click="openFundDialog(guild)">
                {{ guild.fund.toLocaleString() }}
                <PencilIcon class="size-3 inline ml-0.5" />
              </span>
            </div>
            <div>
              <span class="text-muted-foreground">创建: </span>
              <span class="font-medium">{{ formatTimestamp(guild.createdAt) }}</span>
            </div>
          </div>

          <UiButton variant="outline" size="sm" class="w-full" @click="openDetailDialog(guild)">
            查看详情
            <ChevronRightIcon class="size-4 ml-1" />
          </UiButton>
        </div>
      </div>
    </div>

    <UiDialog v-model:open="detailDialogOpen">
      <UiDialogContent class="sm:max-w-[600px]">
        <UiDialogHeader>
          <UiDialogTitle>{{ selectedGuild?.name }} - 公会详情</UiDialogTitle>
        </UiDialogHeader>
        <div v-if="detailLoading" class="flex items-center justify-center py-8">
          <UiSpinner class="size-6" />
        </div>
        <div v-else-if="guildDetail" class="space-y-4 max-h-[60vh] overflow-y-auto">
          <div class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span class="text-muted-foreground">公会ID: </span>
              <span class="font-mono">{{ guildDetail.guild.id }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">等级: </span>
              <span>Lv.{{ guildDetail.guild.level }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">会长: </span>
              <span>{{ guildDetail.guild.ownerName }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">资金: </span>
              <span class="font-mono">{{ guildDetail.guild.fund.toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">成员: </span>
              <span>{{ guildDetail.guild.memberCount }}/{{ guildDetail.guild.maxMembers }}</span>
            </div>
            <div>
              <span class="text-muted-foreground">总部: </span>
              <span class="font-mono text-xs">{{ guildDetail.guild.hqX }}, {{ guildDetail.guild.hqY }}, {{ guildDetail.guild.hqZ }} ({{ guildDetail.guild.hqDim }})</span>
            </div>
          </div>

          <UiSeparator />

          <div>
            <h4 class="text-sm font-semibold mb-2">
              成员列表 ({{ guildDetail.members.length }})
            </h4>
            <div class="border rounded-lg">
              <div class="grid grid-cols-[1fr_100px_180px] gap-4 px-4 py-2 border-b text-xs text-muted-foreground font-medium">
                <span>玩家</span>
                <span>角色</span>
                <span>加入时间</span>
              </div>
              <div
                v-for="member in guildDetail.members"
                :key="member.xuid"
                class="grid grid-cols-[1fr_100px_180px] gap-4 px-4 py-2 border-b last:border-b-0 text-sm"
              >
                <span class="text-xs">
                  {{ memberNameMap.get(member.xuid) || member.xuid }}
                  <span v-if="memberNameMap.has(member.xuid)" class="text-muted-foreground ml-1">({{ member.xuid }})</span>
                </span>
                <span>
                  <UiBadge v-if="member.role === 'owner'" variant="default">会长</UiBadge>
                  <UiBadge v-else-if="member.role === 'admin'" variant="secondary">管理员</UiBadge>
                  <UiBadge v-else variant="outline">成员</UiBadge>
                </span>
                <span class="text-xs text-muted-foreground">{{ formatTimestamp(member.joinedAt) }}</span>
              </div>
              <div v-if="guildDetail.members.length === 0" class="p-4 text-center text-muted-foreground text-sm">
                暂无成员
              </div>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <h4 class="text-sm font-semibold">
                传送点 ({{ guildDetail.teleports.length }})
              </h4>
              <UiButton variant="outline" size="sm" @click="openAddTpDialog(guildDetail.guild)">
                <PlusIcon class="size-3 mr-1" />
                添加
              </UiButton>
            </div>
            <div v-if="guildDetail.teleports.length > 0" class="border rounded-lg">
              <div class="grid grid-cols-[1fr_1fr_120px_60px] gap-4 px-4 py-2 border-b text-xs text-muted-foreground font-medium">
                <span>名称</span>
                <span>坐标</span>
                <span>维度</span>
                <span />
              </div>
              <div
                v-for="tp in guildDetail.teleports"
                :key="tp.id"
                class="grid grid-cols-[1fr_1fr_120px_60px] gap-4 px-4 py-2 border-b last:border-b-0 text-sm items-center"
              >
                <span>{{ tp.name }}</span>
                <span class="font-mono text-xs">{{ tp.x }}, {{ tp.y }}, {{ tp.z }}</span>
                <span>{{ tp.dim }}</span>
                <UiButton variant="ghost" size="icon" class="size-6 text-destructive" @click="openDeleteTpDialog(guildDetail.guild.id, tp)">
                  <TrashIcon class="size-3" />
                </UiButton>
              </div>
            </div>
            <div v-else class="border rounded-lg p-4 text-center text-muted-foreground text-sm">
              暂无传送点
            </div>
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="detailDialogOpen = false">
            关闭
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="editDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>编辑公会</UiDialogTitle>
          <UiDialogDescription>
            修改 {{ selectedGuild?.name }} 的信息
          </UiDialogDescription>
        </UiDialogHeader>
        <div v-if="!editActionResult" class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">公会名称</label>
            <UiInput v-model="editForm.name" placeholder="公会名称" />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">描述</label>
            <UiTextarea v-model="editForm.description" placeholder="公会描述" :rows="2" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">等级</label>
              <UiInput v-model="editForm.level" type="number" :min="1" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">最大成员数</label>
              <UiInput v-model="editForm.maxMembers" type="number" :min="1" />
            </div>
          </div>
          <div v-if="editActionError" class="text-sm text-destructive">
            {{ editActionError }}
          </div>
        </div>
        <div v-else class="py-4">
          <div class="rounded-md bg-muted p-3 text-sm">
            {{ editActionResult }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="editDialogOpen = false">
            {{ editActionResult ? '关闭' : '取消' }}
          </UiButton>
          <UiButton v-if="!editActionResult" :disabled="editActionLoading" @click="handleUpdateGuild">
            {{ editActionLoading ? '保存中...' : '保存' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="deleteDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除公会</UiDialogTitle>
          <UiDialogDescription>
            确定要删除公会"{{ deleteTarget?.name }}"吗？此操作将自动清理所有成员和传送点，不可撤销。
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteLoading" @click="handleDeleteGuild">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="fundDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>修改公会资金</UiDialogTitle>
          <UiDialogDescription>
            修改 {{ fundTarget?.name }} 的资金（当前: {{ fundTarget?.fund.toLocaleString() }}）
          </UiDialogDescription>
        </UiDialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">资金数额</label>
            <UiInput v-model="fundAmount" type="number" :min="0" />
          </div>
          <div v-if="fundActionError" class="text-sm text-destructive">
            {{ fundActionError }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="fundDialogOpen = false">
            取消
          </UiButton>
          <UiButton :disabled="fundActionLoading" @click="handleUpdateFund">
            {{ fundActionLoading ? '保存中...' : '确认' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="addTpDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>添加传送点</UiDialogTitle>
          <UiDialogDescription>
            为 {{ addTpTarget?.name }} 添加传送点
          </UiDialogDescription>
        </UiDialogHeader>
        <div class="space-y-4 py-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">传送点名称</label>
            <UiInput v-model="addTpForm.name" placeholder="如：基地、矿场" />
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div class="space-y-2">
              <label class="text-sm font-medium">X</label>
              <UiInput v-model="addTpForm.x" type="number" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">Y</label>
              <UiInput v-model="addTpForm.y" type="number" />
            </div>
            <div class="space-y-2">
              <label class="text-sm font-medium">Z</label>
              <UiInput v-model="addTpForm.z" type="number" />
            </div>
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">维度</label>
            <UiSelect v-model="addTpForm.dim">
              <UiSelectTrigger>
                <UiSelectValue />
              </UiSelectTrigger>
              <UiSelectContent>
                <UiSelectItem value="0">
                  主世界
                </UiSelectItem>
                <UiSelectItem value="1">
                  下界
                </UiSelectItem>
                <UiSelectItem value="2">
                  末地
                </UiSelectItem>
              </UiSelectContent>
            </UiSelect>
          </div>
          <div v-if="addTpError" class="text-sm text-destructive">
            {{ addTpError }}
          </div>
        </div>
        <UiDialogFooter>
          <UiButton variant="outline" @click="addTpDialogOpen = false">
            取消
          </UiButton>
          <UiButton :disabled="addTpLoading" @click="handleAddTeleport">
            {{ addTpLoading ? '添加中...' : '添加' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>

    <UiDialog v-model:open="deleteTpDialogOpen">
      <UiDialogContent class="sm:max-w-[425px]">
        <UiDialogHeader>
          <UiDialogTitle>删除传送点</UiDialogTitle>
          <UiDialogDescription>
            确定要删除传送点"{{ deleteTpTarget?.tp.name }}"吗？
          </UiDialogDescription>
        </UiDialogHeader>
        <UiDialogFooter>
          <UiButton variant="outline" @click="deleteTpDialogOpen = false">
            取消
          </UiButton>
          <UiButton variant="destructive" :disabled="deleteTpLoading" @click="handleDeleteTeleport">
            {{ deleteTpLoading ? '删除中...' : '确认删除' }}
          </UiButton>
        </UiDialogFooter>
      </UiDialogContent>
    </UiDialog>
  </BasicPage>
</template>
