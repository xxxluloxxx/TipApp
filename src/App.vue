<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { EllipsisVertical, Moon, Pencil, Sun, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'

// --- Toggle de tema (solo para demostrar que light/dark funcionan; el
// selector real de preferencia del sistema es responsabilidad de una
// iteración futura, junto con PWA). ---
const isDark = ref(false)

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark.value)
}

function toggleTheme() {
  isDark.value = !isDark.value
  applyTheme()
}

onMounted(() => {
  isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches
  applyTheme()
})

// --- Datos de ejemplo (no reales, solo para mostrar el sistema de diseño) ---
const gastoDescripcion = ref('')
const gastoMonto = ref('')
const gastoCategoria = ref('comida')

const gastosEjemplo = [
  { id: 1, descripcion: 'Almuerzo oficina', categoria: 'Comida', color: 'bg-[#2a78d6] dark:bg-[#3987e5] text-white', monto: '32.500', fecha: 'Hoy' },
  { id: 2, descripcion: 'Uber al centro', categoria: 'Transporte', color: 'bg-[#1baf7a] dark:bg-[#199e70] text-white', monto: '18.200', fecha: 'Hoy' },
  { id: 3, descripcion: 'Internet hogar', categoria: 'Servicios', color: 'bg-[#eda100] dark:bg-[#c98500] text-neutral-900', monto: '89.900', fecha: 'Ayer' },
]

function onGuardar() {
  toast.success('Gasto guardado', {
    description: 'Este es un ejemplo — todavía no persiste en Supabase.',
  })
}

function onEliminarConfirmado() {
  toast('Gasto eliminado', {
    description: 'Acción de ejemplo confirmada vía Alert Dialog.',
  })
}
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <Toaster rich-colors />

    <header class="flex items-center justify-between border-b border-border px-4 py-4 sm:px-6 lg:px-8">
      <div>
        <h1 class="text-xl font-semibold sm:text-2xl">TipApp</h1>
        <p class="text-sm text-muted-foreground">Sistema de diseño base — vista de verificación</p>
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="Cambiar entre modo claro y oscuro"
        @click="toggleTheme"
      >
        <Sun v-if="isDark" class="size-5" />
        <Moon v-else class="size-5" />
      </Button>
    </header>

    <main class="mx-auto flex max-w-md flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <!-- Monto hero -->
      <Card>
        <CardHeader>
          <CardDescription>Total de julio 2026</CardDescription>
          <CardTitle class="text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
            <span class="text-sm font-normal text-muted-foreground align-top">$</span>
            140.600
          </CardTitle>
        </CardHeader>
        <CardFooter class="text-sm text-muted-foreground">
          Monto de ejemplo — la jerarquía tipográfica sigue la sección 2 del design system.
        </CardFooter>
      </Card>

      <!-- Lista de gastos (card-list, no table) -->
      <section class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Gastos recientes</h2>
        </div>

        <template v-for="(grupo, idx) in [['Hoy', gastosEjemplo.filter(g => g.fecha === 'Hoy')], ['Ayer', gastosEjemplo.filter(g => g.fecha === 'Ayer')]]" :key="idx">
          <template v-if="(grupo[1] as typeof gastosEjemplo).length">
            <Separator v-if="idx > 0" />
            <span class="text-xs font-medium text-muted-foreground">{{ grupo[0] }}</span>

            <Card v-for="gasto in (grupo[1] as typeof gastosEjemplo)" :key="gasto.id" class="p-4 sm:p-6">
              <div class="flex items-start justify-between gap-3">
                <div class="flex flex-col gap-1.5">
                  <p class="font-medium">{{ gasto.descripcion }}</p>
                  <Badge :class="gasto.color" class="w-fit border-transparent">
                    {{ gasto.categoria }}
                  </Badge>
                </div>

                <div class="flex items-center gap-2">
                  <p class="text-right text-base font-semibold tabular-nums">
                    <span class="text-sm font-normal text-muted-foreground">$</span>{{ gasto.monto }}
                  </p>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="ghost" size="icon" aria-label="Más acciones para este gasto">
                        <EllipsisVertical class="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>
                        <Pencil class="size-4" />
                        Editar
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger as-child>
                          <DropdownMenuItem variant="destructive" @select="(e: Event) => e.preventDefault()">
                            <Trash2 class="size-4" />
                            Eliminar
                          </DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Eliminar este gasto?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer. Se eliminará "{{ gasto.descripcion }}" permanentemente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction @click="onEliminarConfirmado">
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </Card>
          </template>
        </template>

        <!-- Skeleton: estado de carga de ejemplo -->
        <p class="text-xs text-muted-foreground">Estado de carga (Skeleton) de ejemplo:</p>
        <Card class="p-4 sm:p-6">
          <div class="flex items-center justify-between gap-3">
            <div class="flex flex-col gap-2">
              <Skeleton class="h-4 w-32" />
              <Skeleton class="h-5 w-20 rounded-full" />
            </div>
            <Skeleton class="h-5 w-16" />
          </div>
        </Card>
      </section>

      <!-- Formulario de ejemplo (Input + Label + Select + Button) -->
      <Card class="p-4 sm:p-6">
        <CardHeader class="px-0">
          <CardTitle class="text-lg">Agregar gasto (demo)</CardTitle>
          <CardDescription>No persiste todavía — solo valida el sistema de diseño.</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 px-0">
          <div class="flex flex-col gap-1.5">
            <Label for="descripcion">Descripción</Label>
            <Input id="descripcion" v-model="gastoDescripcion" placeholder="Ej. Almuerzo" />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="monto">Monto</Label>
            <Input
              id="monto"
              v-model="gastoMonto"
              inputmode="decimal"
              placeholder="0"
              class="text-lg font-semibold tabular-nums"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <Label for="categoria">Categoría</Label>
            <Select v-model="gastoCategoria">
              <SelectTrigger id="categoria" class="h-11 w-full">
                <SelectValue placeholder="Selecciona una categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comida">Comida</SelectItem>
                <SelectItem value="transporte">Transporte</SelectItem>
                <SelectItem value="servicios">Servicios/Hogar</SelectItem>
                <SelectItem value="salud">Salud</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardFooter class="flex gap-3 px-0">
          <Button class="flex-1" @click="onGuardar">
            Agregar gasto
          </Button>

          <Sheet>
            <SheetTrigger as-child>
              <Button variant="outline">Ver como Sheet</Button>
            </SheetTrigger>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>Nuevo gasto</SheetTitle>
                <SheetDescription>
                  Patrón bottom sheet recomendado para el formulario de alta en mobile.
                </SheetDescription>
              </SheetHeader>
              <div class="flex flex-col gap-4 px-4">
                <div class="flex flex-col gap-1.5">
                  <Label for="sheet-descripcion">Descripción</Label>
                  <Input id="sheet-descripcion" placeholder="Ej. Mercado" />
                </div>
                <div class="flex flex-col gap-1.5">
                  <Label for="sheet-monto">Monto</Label>
                  <Input id="sheet-monto" inputmode="decimal" placeholder="0" class="text-lg font-semibold tabular-nums" />
                </div>
              </div>
              <SheetFooter>
                <SheetClose as-child>
                  <Button @click="onGuardar">Guardar</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </CardFooter>
      </Card>

      <p class="pb-8 text-center text-xs text-muted-foreground">
        Toca el ícono de sol/luna arriba para alternar entre light y dark mode.
      </p>
    </main>
  </div>
</template>
