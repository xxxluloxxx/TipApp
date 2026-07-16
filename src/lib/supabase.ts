import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabase] Faltan las variables de entorno VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. '
    + 'Definilas en .env.local (ver .env.example) antes de correr la app en dev. '
    + 'Nunca uses acá la service_role key: solo la anon key es segura en el cliente.',
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)
