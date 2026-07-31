<script lang='ts' setup>
import { FolderOpenIcon } from '@lucide/vue'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
</script>

<template>
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <FolderOpenIcon />
      </EmptyMedia>
      <EmptyTitle>暂无数据</EmptyTitle>
      <EmptyDescription>
        请尝试不同的搜索条件
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
</template>
