import { AuthProvider } from "@/components/AuthContext";
import { Sidebar } from "@/components/Sidebar";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider requireAuth>
      <div className="min-h-screen flex flex-col sm:flex-row bg-gray-100 dark:bg-gray-900">
        <Sidebar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </AuthProvider>
  );
}

