import { loginAction } from "@/lib/auth";
import { PendingButton } from "@/components/pending-button";
import { BrandMark } from "@/components/shell";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <main className="login-page">
      <form className="login-card" action={loginAction}>
        <div className="brand" style={{ padding: 0, marginBottom: 22 }}>
          <BrandMark />
          <div>
            <div className="brand-title" style={{ color: "var(--ink)" }}>Ads Transparency</div>
            <div className="brand-subtitle">Закрытый мониторинг</div>
          </div>
        </div>
        <h1 className="page-title" style={{ fontSize: 24 }}>Вход</h1>
        <div className="grid" style={{ marginTop: 20 }}>
          <input className="input" name="email" placeholder="Почта" type="email" required />
          <input className="input" name="password" placeholder="Пароль" type="password" required />
          {params.error ? <div className="badge red">Неверный логин или пароль</div> : null}
          <PendingButton className="button primary" pendingText="Входим" type="submit">Войти</PendingButton>
        </div>
      </form>
    </main>
  );
}
