<script setup lang="ts">
import { toast } from 'vue-sonner'

import type { IPlayer } from '@/services/api/player.api'

import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { usePlayerApi } from '@/services/api/player.api'

const props = defineProps<{ player: IPlayer }>()
const emit = defineEmits<{ refresh: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { updatePlayerUid } = usePlayerApi()
const uidValue = ref('')
const submitting = ref(false)

function formatUid(uid: number): string {
  return String(uid).padStart(5, '0')
}

watch(() => open.value, (v) => {
  if (v)
    uidValue.value = ''
})

async function handleSubmit() {
  const val = uidValue.value.trim()
  if (!/^\d{5}$/.test(val)) {
    toast.error('请输入5位数字 UID')
    return
  }
  if (submitting.value)
    return
  submitting.value = true
  try {
    const res = await updatePlayerUid(props.player.xuid, val)
    if (res.code === 200) {
      toast.success(`已将 ${props.player.name} 的 UID 更新为 ${formatUid(res.data.uid)}`)
      open.value = false
      emit('refresh')
    }
    else {
      toast.error(res.msg || '更新 UID 失败')
    }
  }
  catch (error: any) {
    toast.error(`更新 UID 失败: ${error?.message || '网络错误'}`)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="sm:max-w-[380px]">
      <UiDialogHeader>
        <UiDialogTitle>重新分配 UID</UiDialogTitle>
        <UiDialogDescription>
          {{ player.name }} 当前 UID：{{ formatUid(player.uid) }}，输入新的 5 位 UID
        </UiDialogDescription>
      </UiDialogHeader>

      <div class="flex justify-center py-4">
        <InputOTP v-model="uidValue" :maxlength="5" pattern="^\d+$" input-mode="numeric">
          <InputOTPGroup class="gap-1.5">
            <InputOTPSlot v-for="i in 5" :key="i" :index="i - 1" class="rounded-md border" />
          </InputOTPGroup>
        </InputOTP>
      </div>

      <UiDialogFooter>
        <UiButton variant="outline" @click="open = false">
          取消
        </UiButton>
        <UiButton :disabled="submitting || uidValue.length !== 5" @click="handleSubmit">
          {{ submitting ? '提交中...' : '确认分配' }}
        </UiButton>
      </UiDialogFooter>
    </UiDialogContent>
  </UiDialog>
</template>
