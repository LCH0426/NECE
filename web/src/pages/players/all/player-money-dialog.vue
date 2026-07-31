<script setup lang="ts">
import type { IPlayer } from '@/services/api/player.api'

import { usePlayerApi } from '@/services/api/player.api'

const props = defineProps<{
  player: IPlayer
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'success': []
}>()

const { moneyOperation } = usePlayerApi()

const action = ref<'add' | 'reduce' | 'set'>('add')
const amount = ref<number | undefined>(undefined)
const submitting = ref(false)
const result = ref<{ before: number, after: number } | null>(null)
const errorMsg = ref('')

async function handleSubmit() {
  if (!amount.value || amount.value <= 0) {
    errorMsg.value = '请输入有效的金额'
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    const res = await moneyOperation(props.player.xuid, action.value, amount.value)
    if (res.code === 200) {
      result.value = { before: res.data.before, after: res.data.after }
      emit('success')
    }
    else {
      errorMsg.value = res.msg || '操作失败'
    }
  }
  catch {
    errorMsg.value = '网络错误'
  }
  finally {
    submitting.value = false
  }
}

function handleClose() {
  emit('update:open', false)
  result.value = null
  amount.value = undefined
  action.value = 'add'
  errorMsg.value = ''
}

watch(() => props.open, (val) => {
  if (!val) {
    result.value = null
    amount.value = undefined
    action.value = 'add'
    errorMsg.value = ''
  }
})
</script>

<template>
  <UiDialog :open="open" @update:open="handleClose">
    <UiDialogContent class="sm:max-w-[425px]">
      <UiDialogHeader>
        <UiDialogTitle>经济操作</UiDialogTitle>
        <UiDialogDescription>
          对玩家 {{ player.name }} (UID: {{ player.uid }}) 进行经济操作，当前余额: {{ player.balance.toLocaleString() }}
        </UiDialogDescription>
      </UiDialogHeader>

      <div v-if="!result" class="space-y-4 py-4">
        <div class="space-y-2">
          <label class="text-sm font-medium">操作类型</label>
          <UiSelect v-model="action">
            <UiSelectTrigger>
              <UiSelectValue />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem value="add">
                增加
              </UiSelectItem>
              <UiSelectItem value="reduce">
                减少
              </UiSelectItem>
              <UiSelectItem value="set">
                设置
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">金额</label>
          <UiInput
            v-model="amount"
            type="number"
            placeholder="请输入金额"
            :min="1"
          />
        </div>

        <div v-if="errorMsg" class="text-sm text-destructive">
          {{ errorMsg }}
        </div>
      </div>

      <div v-else class="space-y-3 py-4">
        <div class="rounded-md bg-muted p-3 text-sm">
          <div class="flex justify-between">
            <span class="text-muted-foreground">操作前余额</span>
            <span class="font-mono">{{ result.before.toLocaleString() }}</span>
          </div>
          <div class="flex justify-between mt-1">
            <span class="text-muted-foreground">操作后余额</span>
            <span class="font-mono font-bold">{{ result.after.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="handleClose">
          {{ result ? '关闭' : '取消' }}
        </UiButton>
        <UiButton v-if="!result" :disabled="submitting" @click="handleSubmit">
          {{ submitting ? '处理中...' : '确认' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
