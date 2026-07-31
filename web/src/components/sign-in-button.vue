<script lang="ts" setup>
const signInUrl = `${import.meta.env.BASE_URL}auth/sign-in`
</script>

<template>
  <UiButton as="a" :href="signInUrl">
    登录
  </UiButton>
</template>
