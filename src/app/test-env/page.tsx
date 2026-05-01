export default function TestEnv() {
  return (
    <div>
      <p>SUPABASE_URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ set' : '❌ missing'}</p>
      <p>SUPABASE_ANON_KEY: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ set' : '❌ missing'}</p>
      <p>SITE_URL: {process.env.NEXT_PUBLIC_SITE_URL ? '✅ set' : '❌ missing'}</p>
    </div>
  )
}
