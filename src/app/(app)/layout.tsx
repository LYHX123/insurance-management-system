import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        user={{
          role: session.user.role,
          status: session.user.status,
          permissions: session.user.permissions ?? [],
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar fullName={session.user.name ?? session.user.username} role={session.user.role} />
        <main className="flex-1 overflow-y-auto bg-zinc-50 p-page">
          {children}
        </main>
      </div>
    </div>
  );
}
