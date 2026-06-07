import { createClient } from "@supabase/supabase-js";

// TODO: Replace with real Supabase credentials
// Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// TODO: Replace mock data fetches with these Supabase queries once credentials are set
export async function fetchDentalTerms() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("dental_terms").select("*");
  if (error) throw error;
  return data;
}

export async function fetchToothStages() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("tooth_stages").select("*");
  if (error) throw error;
  return data;
}

export async function fetchProcedureSteps() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("procedure_steps").select("*");
  if (error) throw error;
  return data;
}
