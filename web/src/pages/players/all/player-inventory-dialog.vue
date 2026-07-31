<script setup lang="ts">
import { toast } from 'vue-sonner'

import type { IArmorItem, IInventoryItem } from '@/services/api/inventory.api'
import type { IPlayer } from '@/services/api/player.api'

import ItemTexture from '@/components/item-texture.vue'
import { useItemData } from '@/composables/use-item-data'
import { useInventoryApi } from '@/services/api/inventory.api'

const props = defineProps<{
  player: IPlayer
  open: boolean
  showRefresh?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { getPlayerInventory } = useInventoryApi()
const { getItemInfo } = useItemData()

const inventoryItems = ref<IInventoryItem[]>([])
const armorItems = ref<IArmorItem[]>([])
const offhandItems = ref<IInventoryItem[]>([])
const online = ref(false)
const saveTime = ref('')
const loading = ref(false)
const errorMsg = ref('')

// 使用 Map 做 O(1) 查找
const itemMap = computed(() => {
  const map = new Map<number, IInventoryItem>()
  for (const item of inventoryItems.value) {
    map.set(item.slot, item)
  }
  return map
})

// 装备栏: 按 slot 名称映射
const armorMap = computed(() => {
  const map = new Map<string, IArmorItem>()
  for (const item of armorItems.value) {
    map.set(item.slot, item)
  }
  return map
})

function getItemAt(slot: number): IInventoryItem | undefined {
  return itemMap.value.get(slot)
}

function getArmorAt(slot: string): IArmorItem | undefined {
  return armorMap.value.get(slot)
}

function getOffhand(): IInventoryItem | undefined {
  return offhandItems.value[0]
}

function getItemTexture(item: IInventoryItem | IArmorItem): string | undefined {
  if (item.image)
    return item.image
  return getItemInfo(item.type)?.texture
}

function getItemDisplayName(item: IInventoryItem | IArmorItem): string {
  const info = getItemInfo(item.type)
  return info?.name || item.name || item.type.replace('minecraft:', '')
}

function formatSaveTime(timestamp: string): string {
  if (!timestamp)
    return ''
  const num = Number(timestamp)
  if (num > 0)
    return new Date(num).toLocaleString('zh-CN')
  return timestamp
}

// 主背包槽位: row(1-3) col(1-9) → slot 9-35
function getMainSlot(row: number, col: number): number {
  return (row - 1) * 9 + col - 1 + 9
}

// 快捷栏: col(1-9) → slot 0-8
function getHotbarSlot(col: number): number {
  return col - 1
}

// 装备栏显示顺序: 头盔, 胸甲, 护腿, 靴子
const armorSlotKeys = ['helmet', 'chestplate', 'leggings', 'boots'] as const
const armorLabels = ['头盔', '胸甲', '护腿', '靴子'] as const

async function fetchInventory() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await getPlayerInventory(props.player.xuid)
    if (res.code === 200) {
      inventoryItems.value = res.data.inventory || []
      armorItems.value = res.data.armor || []
      offhandItems.value = res.data.offhand || []
      online.value = res.data.online
      saveTime.value = res.data.saveTime || ''
    }
    else {
      errorMsg.value = res.msg || '查询失败'
    }
  }
  catch {
    errorMsg.value = '网络错误'
  }
  finally {
    loading.value = false
  }
}

function handleRefresh() {
  fetchInventory()
  toast.success('背包已刷新')
}

function handleClose() {
  emit('update:open', false)
}

defineExpose({ fetchInventory })

watch(() => props.open, (val) => {
  if (val) {
    inventoryItems.value = []
    armorItems.value = []
    offhandItems.value = []
    online.value = false
    saveTime.value = ''
    errorMsg.value = ''
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-[620px]">
      <UiDialogHeader>
        <UiDialogTitle>{{ player.name }} 的背包</UiDialogTitle>
        <UiDialogDescription>
          <span v-if="online" class="text-green-600">在线</span>
          <span v-else class="text-muted-foreground">离线</span>
          <span v-if="saveTime" class="ml-2 text-xs">保存: {{ formatSaveTime(saveTime) }}</span>
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="loading" class="flex items-center justify-center py-12 text-muted-foreground">
        加载中...
      </div>

      <div v-else-if="errorMsg" class="flex items-center justify-center py-12 text-destructive">
        {{ errorMsg }}
      </div>

      <div v-else class="mc-inventory-body">
        <!-- 左侧: 装备栏 + 副手 -->
        <div class="mc-sidebar">
          <div class="mc-section-label">
            装备
          </div>
          <div class="mc-armor-col">
            <div
              v-for="(slot, idx) in armorSlotKeys"
              :key="`armor-${slot}`"
              class="mc-armor-row"
            >
              <span class="mc-armor-label">{{ armorLabels[idx] }}</span>
              <div class="mc-slot mc-slot-armor">
                <template v-if="getArmorAt(slot)">
                  <div class="mc-item" :title="getItemDisplayName(getArmorAt(slot)!)">
                    <ItemTexture
                      :texture="getItemTexture(getArmorAt(slot)!)"
                      :size="28"
                    />
                    <span v-if="getArmorAt(slot)!.count > 1" class="mc-count">
                      {{ getArmorAt(slot)!.count }}
                    </span>
                  </div>
                </template>
              </div>
            </div>
            <div class="mc-armor-row">
              <span class="mc-armor-label">副手</span>
              <div class="mc-slot mc-slot-armor">
                <template v-if="getOffhand()">
                  <div class="mc-item" :title="getItemDisplayName(getOffhand()!)">
                    <ItemTexture
                      :texture="getItemTexture(getOffhand()!)"
                      :size="28"
                    />
                    <span v-if="getOffhand()!.count > 1" class="mc-count">
                      {{ getOffhand()!.count }}
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧: 主背包 + 快捷栏 -->
        <div class="mc-main">
          <!-- 主背包 3×9 -->
          <div class="mc-section">
            <div class="mc-section-label">
              背包
            </div>
            <div class="mc-inventory-grid">
              <template v-for="row in 3" :key="`main-${row}`">
                <div
                  v-for="col in 9"
                  :key="`main-${row}-${col}`"
                  class="mc-slot"
                >
                  <template v-if="getItemAt(getMainSlot(row, col))">
                    <div class="mc-item" :title="getItemDisplayName(getItemAt(getMainSlot(row, col))!)">
                      <ItemTexture
                        :texture="getItemTexture(getItemAt(getMainSlot(row, col))!)"
                        :size="32"
                      />
                      <span v-if="getItemAt(getMainSlot(row, col))!.count > 1" class="mc-count">
                        {{ getItemAt(getMainSlot(row, col))!.count }}
                      </span>
                    </div>
                  </template>
                </div>
              </template>
            </div>
          </div>

          <!-- 快捷栏 1×9 -->
          <div class="mc-section">
            <div class="mc-section-label">
              快捷栏
            </div>
            <div class="mc-inventory-grid">
              <div
                v-for="col in 9"
                :key="`hotbar-${col}`"
                class="mc-slot mc-slot-hotbar"
              >
                <template v-if="getItemAt(getHotbarSlot(col))">
                  <div class="mc-item" :title="getItemDisplayName(getItemAt(getHotbarSlot(col))!)">
                    <ItemTexture
                      :texture="getItemTexture(getItemAt(getHotbarSlot(col))!)"
                      :size="32"
                    />
                    <span v-if="getItemAt(getHotbarSlot(col))!.count > 1" class="mc-count">
                      {{ getItemAt(getHotbarSlot(col))!.count }}
                    </span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <UiDialogFooter>
        <UiButton
          v-if="showRefresh"
          variant="outline"
          size="sm"
          :disabled="loading"
          @click="handleRefresh"
        >
          刷新
        </UiButton>
        <UiButton variant="outline" @click="handleClose">
          关闭
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>

<style scoped>
.mc-inventory-body {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: var(--inventory-bg, #c6c6c6);
  border: 2px solid var(--inventory-border, #555);
  border-radius: 4px;
}

.dark .mc-inventory-body {
  --inventory-bg: #373737;
  --inventory-border: #1a1a1a;
}

.mc-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.mc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mc-section {
  margin-bottom: 6px;
}

.mc-main > .mc-section:last-child {
  margin-top: auto;
  margin-bottom: 0;
}

.mc-section-label {
  font-size: 11px;
  color: var(--inventory-label, #3f3f3f);
  margin-bottom: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dark .mc-section-label {
  --inventory-label: #aaa;
}

.mc-inventory-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: 2px;
}

.mc-slot {
  width: 36px;
  height: 36px;
  background: var(--slot-bg, #8b8b8b);
  border: 2px solid;
  border-color: var(--slot-border-dark, #555) var(--slot-border-light, #fff) var(--slot-border-light, #fff)
    var(--slot-border-dark, #555);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.dark .mc-slot {
  --slot-bg: #555;
  --slot-border-dark: #333;
  --slot-border-light: #777;
}

.mc-slot-hotbar {
  border-color: var(--hotbar-border-dark, #373737) var(--hotbar-border-light, #dfdfdf)
    var(--hotbar-border-light, #dfdfdf) var(--hotbar-border-dark, #373737);
  background: var(--hotbar-bg, #717171);
}

.dark .mc-slot-hotbar {
  --hotbar-bg: #444;
  --hotbar-border-dark: #222;
  --hotbar-border-light: #666;
}

.mc-slot-armor {
  width: 36px;
  height: 36px;
}

.mc-armor-col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mc-armor-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mc-armor-label {
  font-size: 9px;
  color: var(--inventory-label, #555);
  width: 24px;
  text-align: right;
  flex-shrink: 0;
}

.dark .mc-armor-label {
  --inventory-label: #999;
}

.mc-offhand-section {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.mc-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mc-count {
  position: absolute;
  bottom: -2px;
  right: -2px;
  font-size: 11px;
  font-weight: bold;
  color: #fff;
  text-shadow:
    1px 1px 0 #3f3f3f,
    -1px -1px 0 #3f3f3f,
    1px -1px 0 #3f3f3f,
    -1px 1px 0 #3f3f3f;
  line-height: 1;
}
</style>
