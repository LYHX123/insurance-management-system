import { LoginForm } from "@/components/login-form";
import { LoginTitleClient } from "@/components/login-title";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-700 text-lg font-bold text-white">
            IMS
          </div>
          <div className="rounded-md bg-emerald-800 px-1 py-1">
            <LanguageSwitcher />
          </div>
        </div>

        <Card className="p-8">
          <LoginTitleClient />
          <LoginForm />
        </Card>
      </div>
    </div>
  );
}
