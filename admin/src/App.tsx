import { useState, useCallback, lazy, Suspense } from "react";
import type { Page } from "./types";
import { api } from "./api";
import { AuthGate } from "./components/AuthGate";
import { Header } from "./components/Header";
import { EconomyOverview } from "./pages/EconomyOverview";
import { RegionDetail } from "./pages/RegionDetail";
import { InfraHealth } from "./pages/InfraHealth";

const TradeRouteViewer = lazy(() => import("./pages/TradeRouteViewer"));

export default function App() {
  const [authenticated, setAuthenticated] = useState(!!api.getApiKey());
  const [page, setPage] = useState<Page>("economy");
  const [selectedRegion, setSelectedRegion] = useState("core-worlds");

  const handleAuth = useCallback(() => setAuthenticated(true), []);

  const handleLogout = useCallback(() => {
    api.clearApiKey();
    setAuthenticated(false);
  }, []);

  const handleSelectRegion = useCallback((regionId: string) => {
    setSelectedRegion(regionId);
    setPage("region");
  }, []);

  const handleBack = useCallback(() => setPage("economy"), []);

  if (!authenticated) {
    return <AuthGate onAuthenticated={handleAuth} />;
  }

  return (
    <div className="app-layout">
      <Header
        currentPage={page}
        onNavigate={setPage}
        onLogout={handleLogout}
      />
      <div className={page === "viewer" ? "app-content-viewer" : "app-content"}>
        {page === "economy" && (
          <EconomyOverview onSelectRegion={handleSelectRegion} />
        )}
        {page === "region" && (
          <RegionDetail regionId={selectedRegion} onBack={handleBack} />
        )}
        {page === "viewer" && (
          <Suspense fallback={<div className="loading">Loading viewer...</div>}>
            <TradeRouteViewer />
          </Suspense>
        )}
        {page === "infra" && <InfraHealth />}
      </div>
    </div>
  );
}
