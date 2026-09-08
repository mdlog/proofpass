import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState } from "react";
import Home from "./pages/Home";
import { ThemeProvider } from "./contexts/ThemeContext";

export type Workspace = "overview" | "credentials" | "requests" | "activity" | "issuer" | "verifier" | "settings";

function App() {
  const [workspace, setWorkspace] = useState<Workspace>("overview");

  return (
      <ThemeProvider defaultTheme="light" switchable>
      <TooltipProvider>
        <Toaster position="top-right" richColors />
        <Home workspace={workspace} onWorkspaceChange={setWorkspace} />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
