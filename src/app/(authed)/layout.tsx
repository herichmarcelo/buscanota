import { AuthProvider } from "@/components/AuthContext";
import { AuthedShell } from "@/components/AuthedShell";

export default function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider requireAuth>
      <AuthedShell>{children}</AuthedShell>
    </AuthProvider>
  );
}

