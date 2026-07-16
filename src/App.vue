<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

const now = ref(new Date())
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  clearInterval(timer)
})

const formattedNow = () =>
  now.value.toLocaleString('es-CO', {
    dateStyle: 'full',
    timeStyle: 'medium',
  })
</script>

<template>
  <main>
    <h1>TipApp</h1>
    <p>Esqueleto de validación de deploy.</p>
    <p class="clock">{{ formattedNow() }}</p>
  </main>
</template>

<style scoped>
main {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 100vh;
  text-align: center;
  font-family: system-ui, sans-serif;
  padding: 1rem;
}

h1 {
  font-size: 2.5rem;
  margin: 0;
}

.clock {
  font-variant-numeric: tabular-nums;
  font-size: 1.1rem;
  color: #555;
}
</style>
