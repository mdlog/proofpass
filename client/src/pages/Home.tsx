import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Building2,
  Blocks,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Copy,
  Fingerprint,
  FileCheck2,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SunMoon,
  UserRound,
  WalletCards,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { isLoginConfigured, startLogin } from "../const";
import type { Workspace } from "../App";
import { useTheme } from "../contexts/ThemeContext";
import { awaitWalletResponse, connectMidnightWallet, discoverWalletNetwork, isStaleProviderError, WalletNetworkMismatchError, WalletStaleError, WalletUnresponsiveError, detectForeignWallets, getNetworkLabel, getStoredNetwork, getWalletInstallUrl, MIDNIGHT_NETWORKS, scanMidnightWallets, setStoredNetwork, SUPPORTED_API_MAJOR, type DetectedWallet, type ForeignWallet, type IncompatibleWallet, type MidnightNetwork, type MidnightWalletSession } from "../lib/midnightWallet";
import { createCompactContractRequest, describeCompactIntegration, getDefaultCompactArtifactManifest, loadCompactArtifact } from "../lib/midnightContract";
import { describeError, readableMessage } from "../lib/describeError";
import { OnChainWorkflow, type IssuedCredential } from "../components/OnChainWorkflow";
import { usePersistFn } from "../hooks/usePersistFn";
import { fetchChainTip } from "../lib/chainTip";
import { issuerDisplayName } from "../lib/proofpassContract";
import { issuerForContract, rememberDeployedContract } from "../lib/deployedContract";
import { deployProofPass } from "../lib/proofpassDeploy";
import { trpc } from "../lib/trpc";
import { ApprovalModal } from "../components/ApprovalModal";
import { CreateRequestModal } from "../components/CreateRequestModal";
import { DemoTag } from "../components/DemoTag";
import { RequestRow } from "../components/ProofRequestCard";
import { StatusPill } from "../components/StatusBadge";
import { toActivityItems, type ActivityItem } from "../lib/activity";
import { activityItems, initialRequests } from "../lib/mock-data";
import { CONSENT_VERSION, serverRequestId, preferStored, toDisplayCredential, toDisplayRequest, verificationTrend, credentialSummary, disclosureSummary, type CredentialStatus, type DisclosureSummary, type CredentialView, type NewRequestInput, type ProofRequestView, type RequestStatus, type ServerProofRequest } from "../lib/types";

type NavItem = {
  id: Workspace;
  label: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "credentials", label: "Credentials", icon: BadgeCheck },
  { id: "requests", label: "Proof requests", icon: FileCheck2 },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const pageTitle: Record<Workspace, string> = { overview: "Overview", credentials: "Credentials", requests: "Proof requests", activity: "Activity", issuer: "Issuer workspace", verifier: "Verifier workspace", onchain: "On-chain workflow", settings: "Settings" };

const roleNavItems: NavItem[] = [
  { id: "issuer", label: "Issuer workspace", icon: Building2 },
  { id: "verifier", label: "Verifier workspace", icon: ShieldCheck },
  { id: "onchain", label: "On-chain workflow", icon: Blocks },
];

const seededCredentials: CredentialView[] = [
  {
    id: "cred-001",
    title: "Cybersecurity Bootcamp",
    issuer: "Northstar Academy",
    issued: "18 Aug 2026",
    expires: "18 Aug 2027",
    status: "Active",
    accent: "teal",
    mark: "N",
    seeded: true,
  },
  {
    id: "cred-002",
    title: "Midnight Builder Pass",
    issuer: "Midnight Foundation",
    issued: "07 Aug 2026",
    expires: "07 Nov 2026",
    status: "Expiring soon",
    accent: "coral",
    mark: "M",
    seeded: true,
  },
  {
    id: "cred-003",
    title: "Responsible AI Principles",
    issuer: "Open Learning Guild",
    issued: "29 Jul 2026",
    expires: "29 Jul 2027",
    status: "Active",
    accent: "violet",
    mark: "O",
    seeded: true,
  },
  {
    id: "cred-004",
    title: "Community Steward",
    issuer: "Civic Labs",
    issued: "11 Jun 2026",
    expires: "11 Jun 2027",
    status: "Revoked",
    accent: "slate",
    mark: "C",
    seeded: true,
  },
];

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand-mark ${small ? "brand-mark-small" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="section-description">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Sidebar({ workspace, onWorkspaceChange, onClose, accountName, counts }: { workspace: Workspace; onWorkspaceChange: (workspace: Workspace) => void; onClose?: () => void; accountName: string | null; counts: Partial<Record<Workspace, number>> }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand-lockup">
          <BrandMark />
          <div>
            <div className="brand-name">proofpass</div>
            <div className="brand-caption">PRIVATE CREDENTIALS</div>
          </div>
        </div>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X size={18} /></button>
      </div>

      <div className="workspace-switcher">
        <div className="workspace-avatar">{accountName ? initials(accountName) : "?"}</div>
        <div className="workspace-copy"><span>Personal workspace</span><strong>{accountName ?? "Not signed in"}</strong></div>
        <ChevronDown size={15} className="muted-icon" />
      </div>

      <div className="nav-group">
        <p className="nav-label">Workspace</p>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return (
              <button key={item.id} className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => { onWorkspaceChange(item.id); onClose?.(); }}>
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                <span>{item.label}</span>
                {counts[item.id] !== undefined && <span className="nav-count">{counts[item.id]}</span>}
              </button>
            );
          })}
        </nav>
        <p className="nav-label nav-label-role">Roles</p>
        <nav aria-label="Role workspaces">
          {roleNavItems.map((item) => {
            const Icon = item.icon;
            const active = workspace === item.id;
            return <button key={item.id} className={`nav-item ${active ? "nav-item-active" : ""}`} onClick={() => { onWorkspaceChange(item.id); onClose?.(); }}><Icon size={18} strokeWidth={active ? 2.2 : 1.8} /><span>{item.label}</span><ChevronRight size={14} className="role-nav-arrow" /></button>;
          })}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <div className="privacy-card">
          <div className="privacy-card-icon"><LockKeyhole size={16} /></div>
          <div><strong>Privacy by default</strong><span>Your data stays yours.</span></div>
          <ChevronRight size={15} className="privacy-arrow" />
        </div>
        <div className="network-status"><span className="network-pulse" /><span>{getNetworkLabel()}</span><span className="network-mode">Demo mode</span></div>
      </div>
    </aside>
  );
}

function Topbar({ workspace, onOpenMenu, onSearch, walletSession, walletCount, onConnect }: { workspace: Workspace; onOpenMenu: () => void; onSearch: () => void; walletSession: MidnightWalletSession | null; walletCount: number; onConnect: () => void }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={onOpenMenu}><Menu size={20} /></button>
      <nav className="breadcrumbs" aria-label="Breadcrumb"><span>Personal workspace</span><ChevronRight size={14} /><strong>{pageTitle[workspace]}</strong></nav>
      <div className="topbar-actions">
        <button className="search-trigger" onClick={onSearch}><Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd></button>
        <button className={`wallet-button ${walletSession ? "wallet-button-connected" : ""}`} onClick={onConnect}><WalletCards size={15} /><span>{walletSession ? walletSession.address : walletCount ? "Connect wallet" : "Install wallet"}</span></button>
        <button className="icon-button theme-toggle" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={toggleTheme}><SunMoon size={18} /></button>
        <button className="icon-button notification-button" aria-label="Notifications" onClick={() => toast("You’re all caught up", { description: "No new privacy alerts." })}><Bell size={18} /><span className="notification-dot" /></button>
        <div className="topbar-avatar">AC</div>
      </div>
    </header>
  );
}

function Overview({ onWorkspaceChange, onApprove, requests, activity, walletSession, metrics, chainHeight, disclosure }: { onWorkspaceChange: (workspace: Workspace) => void; onApprove: (id: string) => void; requests: ProofRequestView[]; activity: ActivityItem[]; walletSession: MidnightWalletSession | null; metrics: { credentials?: number; activeCredentials?: number; proofsShared?: number }; chainHeight?: number; disclosure?: DisclosureSummary }) {
  return (
    <div className="page-content page-overview">
      <div className="hero-grid">
        <section className="welcome-panel animate-in">
          <div className="grid-pattern" />
          <div className="welcome-copy">
            <div className="hero-kicker"><span className={`live-dot ${walletSession ? "" : "live-dot-idle"}`} />{walletSession ? "Wallet connected" : "No wallet connected"} <span className="hero-separator">/</span> {walletSession ? getNetworkLabel(walletSession.network) : "Demo mode"}</div>
            <h1>Proofs, not paperwork.</h1>
            <p>Share exactly what’s needed to verify your credentials. Keep everything else private.</p>
            <button className="button button-light" onClick={() => onWorkspaceChange("requests")}>Review proof requests <ArrowUpRight size={16} /></button>
          </div>
          <div className="hero-orbit" aria-hidden="true"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><Fingerprint size={26} /></div><span className="orbit-node node-one" /><span className="orbit-node node-two" /><span className="orbit-node node-three" /></div>
          <div className="hero-footnote"><span>Private state enabled</span>{chainHeight !== undefined && <span className="hero-chain">Block {chainHeight.toLocaleString("en-US")} <ChevronRight size={13} /></span>}</div>
        </section>
        <section className="privacy-score-card animate-in delay-1">
            <div className="card-topline"><span className="eyebrow">Disclosure</span><CircleHelp size={16} className="muted-icon" /></div>
            <div className="score-row"><div className="score-number">{count(disclosure?.disclosed)}<span>attributes</span></div></div>
            <p className="score-description">{disclosure
              ? `Handed to verifiers across ${disclosure.proofs} proof${disclosure.proofs === 1 ? "" : "s"}, with ${disclosure.withheld} withheld. None of it reaches the ledger — the contract stores commitments, never attributes.`
              : "Sign in to count what you have actually disclosed."}</p>
            <button className="text-button" onClick={() => toast("How this is counted", { description: "Every approval writes a consent record naming the attributes disclosed. These are those, counted. Approving currently sends every attribute a verifier asks for — this build has no selective disclosure." })}>How this is counted <ChevronRight size={15} /></button>
          </section>
      </div>

      <div className="metric-grid">
        <MetricCard icon={BadgeCheck} label="Active credentials" value={count(metrics.activeCredentials)} detail={metrics.credentials === undefined ? "none stored yet" : `of ${metrics.credentials} total`} accent="teal" onClick={() => onWorkspaceChange("credentials")} />
        <MetricCard icon={ClipboardCheck} label="Proofs shared" value={count(metrics.proofsShared)} detail="recorded in your registry" accent="coral" />
        <MetricCard icon={LockKeyhole} label="Attributes on chain" value="0" detail="the ledger stores commitments only" accent="violet" />
      </div>

      <div className="content-grid">
        <section className="panel panel-requests animate-in delay-2">
          <div className="panel-heading"><div><p className="eyebrow">Needs your attention</p><h2>Proof requests</h2></div><button className="text-button" onClick={() => onWorkspaceChange("requests")}>View all <ChevronRight size={15} /></button></div>
          <div className="request-list">
            {requests.slice(0, 2).map((request) => <RequestRow key={request.id} request={request} onApprove={onApprove} />)}
          </div>
        </section>
        <section className="panel panel-activity animate-in delay-3">
          <div className="panel-heading"><div><p className="eyebrow">Your trail</p><h2>Recent activity</h2></div><button className="icon-button" aria-label="More activity options" onClick={() => toast("Activity filters", { description: "Filtering is available in the Activity workspace." })}><MoreHorizontal size={18} /></button></div>
          <div className="activity-list">{activity.slice(0, 3).map((item, index) => <ActivityRow key={`${item.title}-${index}`} item={item} />)}</div>
        </section>
      </div>

      <section className="principle-banner animate-in delay-4"><div className="principle-icon"><ShieldCheck size={23} /></div><div><p className="eyebrow">The ProofPass principle</p><h3>Verification shouldn’t require visibility.</h3><p>Every proof is purpose-bound, time-limited, and approved by you.</p></div><button className="button button-ghost" onClick={() => onWorkspaceChange("settings")}>Manage privacy defaults <ChevronRight size={16} /></button></section>
    </div>
  );
}

/** PRD §5: a figure that is not stored is shown as absent, never invented. */
const count = (value?: number) => value === undefined ? "—" : String(value);

function MetricCard({ icon: Icon, label, value, detail, accent, trend, onClick, demo = false }: { icon: LucideIcon; label: string; value: string; detail: string; accent: string; trend?: string; onClick?: () => void; demo?: boolean }) {
  return <button className={`metric-card metric-${accent}`} onClick={onClick}><div className="metric-icon"><Icon size={18} /></div><div className="metric-label">{label}{demo && <DemoTag />}</div><div className="metric-value">{value}</div><div className="metric-detail">{trend && <span className="metric-trend"><ArrowUpRight size={12} />{trend}</span>} {detail}</div></button>;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const Icon = item.icon;
  return <div className="activity-row"><div className={`activity-icon activity-${item.type}`}><Icon size={16} /></div><div className="activity-main"><strong>{item.title}{item.seeded && <span className="demo-tag" title="Seeded demo data — not stored">Demo</span>}</strong><p>{item.detail}</p></div><span className="activity-time">{item.time}</span></div>;
}

function Credentials({ onIssue, credentials }: { onIssue: () => void; credentials: CredentialView[] }) {
  const [filter, setFilter] = useState<CredentialStatus | "All">("All");
  const filtered = useMemo(() => filter === "All" ? credentials : credentials.filter((credential) => credential.status === filter), [filter]);
  return <div className="page-content"><SectionHeader eyebrow="Your credentials" title="Credentials" description="A private collection of verifiable facts, held by you." action={<button className="button button-primary" onClick={onIssue}><Plus size={16} /> Issue on chain</button>} />
      <p className="modal-note">{credentialSummary(credentials)}</p>
    <div className="toolbar"><div className="segmented-control">{(["All", "Active", "Expiring soon", "Revoked"] as const).map((item) => <button key={item} className={filter === item ? "segment-active" : ""} onClick={() => setFilter(item)}>{item}{item === "All" && <span>{credentials.length}</span>}</button>)}</div><button className="filter-button" onClick={() => toast("Credential filters", { description: "Sort and issuer filters are coming soon." })}><SlidersIcon /> Filter <ChevronDown size={14} /></button></div>
    <div className="credential-grid">{filtered.map((credential, index) => <CredentialCard key={credential.id} credential={credential} index={index} onClick={() => toast(credential.title, { description: `${credential.issuer} · ${credential.status}` })} />)}</div>
  </div>;
}

function SlidersIcon() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>; }

function CredentialCard({ credential, index, onClick }: { credential: CredentialView; index: number; onClick: () => void }) {
  return <button className={`credential-card accent-${credential.accent} animate-in`} style={{ animationDelay: `${index * 50}ms` }} onClick={onClick}><div className="credential-card-top"><div className="issuer-mark">{credential.mark}</div><StatusPill status={credential.status} />{credential.seeded && <DemoTag />}<MoreHorizontal size={18} className="credential-more" /></div><div className="credential-card-content"><p className="credential-type">VERIFIABLE CREDENTIAL</p><h2>{credential.title}</h2><p className="credential-issuer">Issued by <strong>{credential.issuer}</strong></p></div><div className="credential-card-footer">{credential.credentialKey && <span className="credential-commitment" title={credential.credentialKey}>on chain · {credential.credentialKey.slice(0, 10)}…</span>}<span>Issued {credential.issued}</span><span>Valid until {credential.expires}</span><ChevronRight size={16} /></div><div className="card-watermark"><Fingerprint size={96} /></div></button>;
}

function ProofRequests({ onApprove, requests, onCreate }: { onApprove: (id: string) => void; requests: ProofRequestView[]; onCreate: () => void }) {
  const [filter, setFilter] = useState<RequestStatus | "All">("All");
  const filtered = filter === "All" ? requests : requests.filter((request) => request.status === filter);
  return <div className="page-content"><SectionHeader eyebrow="Consent center" title="Proof requests" description="Review what each verifier wants to see before sharing." action={<button className="button button-dark" onClick={onCreate}><QrCode size={16} /> Create request</button>} />
    <div className="requests-callout"><div className="callout-icon"><LockKeyhole size={18} /></div><div><strong>Nothing is shared without your approval.</strong><span>Each request is scoped to a purpose and expires automatically.</span></div><div className="callout-rule" /><div className="callout-stat"><span>2</span><small>pending now</small></div></div>
    <div className="toolbar"><div className="segmented-control">{(["All", "Pending", "Approved", "Declined", "Expired"] as const).map((item) => <button key={item} className={filter === item ? "segment-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="filter-button" onClick={() => toast("Request filters", { description: "Newest requests are shown first." })}><Clock3 size={15} /> Newest first <ChevronDown size={14} /></button></div>
    <div className="request-page-list">{filtered.map((request) => <RequestRow key={request.id} request={request} onApprove={onApprove} />)}</div>
  </div>;
}

function ActivityPage({ activity, proofsShared, trend }: { activity: ActivityItem[]; proofsShared?: number; trend: number[] }) {
  return <div className="page-content"><SectionHeader eyebrow="Audit trail" title="Activity" description="A lightweight trail of what was requested, shared, and verified." action={<button className="filter-button" onClick={() => toast("Export activity", { description: "Export is available in the production workspace." })}><ArrowDownRight size={15} /> Export</button>} /><div className="activity-summary"><div><span className="eyebrow">Proofs shared</span><strong>{count(proofsShared)}</strong><p>{proofsShared === undefined ? "Sign in to read your own trail." : `in the last ${trend.length} days`}</p></div><div className="summary-visual">{trend.map((value, day) => {
      const tallest = Math.max(...trend, 1);
      return <span key={day} style={{ height: `${Math.round((value / tallest) * 100)}%` }} title={`${value} on day ${day + 1} of ${trend.length}`} />;
    })}</div><div className="summary-legend"><span><i className="legend-teal" /> Approved</span><span><i className="legend-coral" /> Requests</span></div></div><div className="activity-table"><div className="table-head"><span>Event</span><span>Context</span><span>Timestamp</span><span>Status</span></div>{activity.map((item, index) => { const Icon = item.icon; return <div className="table-row" key={`${item.title}-${index}`}><div className="table-event"><div className={`activity-icon activity-${item.type}`}><Icon size={15} /></div><strong>{item.title}</strong>{item.seeded && <span className="demo-tag" title="Seeded demo data — not stored">Demo</span>}</div><span>{item.detail.split(" · ")[0]}</span><span>{item.time}</span><StatusPill status={item.type === "revoked" ? "Revoked" : item.type === "approved" ? "Approved" : "Pending"} /></div>; })}</div></div>;
}

function Settings({ walletSession, onConnect, network, onNetworkChange }: { walletSession: MidnightWalletSession | null; onConnect: () => void; network: MidnightNetwork; onNetworkChange: (next: MidnightNetwork) => void }) {
  const { theme, toggleTheme } = useTheme();

  /**
   * The privacy rows are statements, not choices.
   *
   * They used to be toggles that forgot themselves on reload, which implied the
   * guarantees were optional. Each is a property of how this build works — the
   * consent screen is not skippable, activity never carries attributes, and the
   * wallet signs because the app holds no key (ARCHITECTURE §18) — so they are
   * shown locked, with the reason.
   */
  const guarantee = (title: string, description: string) =>
    <SettingToggle key={title} title={title} description={description} checked onChange={() => {}} locked />;

  return <div className="page-content settings-page"><SectionHeader eyebrow="Workspace controls" title="Settings" description="What this build guarantees, and the two preferences it remembers." /><div className="settings-grid"><section className="settings-panel"><div className="settings-panel-heading"><div className="settings-icon"><LockKeyhole size={18} /></div><div><h2>Privacy guarantees</h2><p>Properties of this build, not switches.</p></div></div>
      {guarantee("Ask before every proof", "The consent screen cannot be skipped; nothing is shared without it.")}
      {guarantee("Hide private attributes in activity", "Activity records the proof scope and the verifier, never the attributes.")}
      {guarantee("Wallet signs every transaction", "ProofPass prepares transactions and holds no key, so the wallet confirms each one.")}
    </section>
    <section className="settings-panel"><div className="settings-panel-heading"><div className="settings-icon settings-icon-coral"><Bell size={18} /></div><div><h2>Preferences</h2><p>Remembered in this browser.</p></div></div>
      <div className="setting-row"><div><strong>Dark mode</strong><p>Follows this browser, remembered between visits.</p></div><button className={`toggle ${theme === "dark" ? "toggle-on" : ""}`} aria-pressed={theme === "dark"} aria-label={`Dark mode: ${theme === "dark" ? "on" : "off"}`} onClick={() => toggleTheme?.()}>{theme === "dark" && <Check size={13} />}</button></div>
      <div className="setting-row"><div><strong>Midnight network</strong><p>The network the wallet is asked to connect on.</p></div><div className="network-options" role="group" aria-label="Midnight network">{MIDNIGHT_NETWORKS.map((option) => <button key={option} type="button" className={`network-chip ${option === network ? "network-chip-active" : ""}`} onClick={() => onNetworkChange(option)} aria-pressed={option === network}>{option}</button>)}</div></div>
    </section></div>
    <section className="wallet-panel"><div className="wallet-visual"><div className="wallet-chip"><WalletCards size={20} /></div><div><span className="eyebrow">Connected wallet</span><strong>{walletSession ? walletSession.address : "No wallet connected"}</strong><span>{walletSession ? `${walletSession.wallet.name} · ${getNetworkLabel(walletSession.network)}` : `Nothing is signed until one is connected on ${getNetworkLabel(network)}.`}</span></div></div>
      <button className="button button-ghost" onClick={onConnect}>{walletSession ? "Change wallet" : "Connect wallet"} <ChevronRight size={16} /></button>
    </section>
  </div>;
}

function SettingToggle({ title, description, checked, onChange, locked = false }: { title: string; description: string; checked: boolean; onChange: (next: boolean) => void; locked?: boolean }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><button className={`toggle ${checked ? "toggle-on" : ""} ${locked ? "toggle-locked" : ""}`} aria-pressed={checked} aria-label={`${title}: ${checked ? "on" : "off"}`} onClick={() => !locked && onChange(!checked)}>{checked && <Check size={13} />}</button></div>;
}

function IssuerWorkspace({ walletSession, onConnect, onRegisterIssuer, onDeployContract, deploying, credentialCount, activeCredentialCount, revokedCount, expiringCount, artifactReady }: { walletSession: MidnightWalletSession | null; onConnect: () => void; onRegisterIssuer: () => void; onDeployContract: () => void; deploying: boolean; credentialCount?: number; activeCredentialCount?: number; revokedCount?: number; expiringCount?: number; artifactReady?: boolean }) {
  // These used to fall back to 124 / 118 / 2, which meant a visitor with no
  // session — a judge opening the link — was shown a fabricated registry as if
  // it were real. An unknown count is now shown as unknown.
  const artifactState = describeCompactIntegration();
  const prepareIssue = async () => {
    if (!walletSession) {
      onConnect();
      return;
    }
    const manifest = getDefaultCompactArtifactManifest();
    if (!manifest) {
      toast.error("Compact artifact not compiled", { description: "Run `pnpm contracts:build` to compile contracts/proofpass.compact before preparing an on-chain issue transaction." });
      return;
    }
    try {
      const artifact = await loadCompactArtifact(manifest);
      const request = createCompactContractRequest(artifact, "issueCredential", ["subject-commitment", "credential-type"]);
      toast.success("Compact circuit ready", { description: `${request.contractName}.${request.circuit} validated at ${request.networkId}. Wallet confirmation is the next step.` });
    } catch (error) {
      toast.error("Compact artifact could not load", { description: error instanceof Error ? error.message : "Check the generated module and compiled asset URL." });
    }
  };
  const artifactIsReady = artifactReady || artifactState.configured;
  return <div className="page-content role-page"><SectionHeader eyebrow="Issuer workspace" title="Issue with confidence." description="Create, manage, and revoke credentials without exposing holder data." action={<><button className="button button-light" onClick={onDeployContract} disabled={deploying || !artifactIsReady}>{deploying ? "Deploying…" : <><Blocks size={16} /> Deploy contract</>}</button><button className="button button-primary" onClick={prepareIssue}><Plus size={16} /> Issue credential</button></>} /><div className="role-hero role-issuer"><div><div className="hero-kicker"><span className="live-dot" />Issuer controls <span className="hero-separator">/</span> Northstar Academy <DemoTag /></div><h2>Credential registry</h2><p>Keep the source data private while making status independently verifiable.</p></div><div className="role-hero-stat"><span>{count(credentialCount)}</span><small>credentials issued</small><b><ArrowUpRight size={13} /> 18.2% <DemoTag /></b></div></div><div className="role-grid"><section className="panel role-stat-panel"><div className="panel-heading"><div><p className="eyebrow">Registry health</p><h2>Issuer controls</h2></div><Building2 size={19} className="muted-icon" /></div><div className="role-control-list"><div><span>Active credentials</span><strong>{count(activeCredentialCount)}</strong></div><div><span>Expiring soon</span><strong>{count(expiringCount)}</strong></div><div><span>Revoked</span><strong>{count(revokedCount)}</strong></div></div></section><section className="panel role-stat-panel"><div className="panel-heading"><div><p className="eyebrow">Latest activity</p><h2>Registry events <DemoTag /></h2></div><button className="text-button" onClick={() => toast("Issuer activity", { description: "The complete registry audit log is available in Activity." })}>View log <ChevronRight size={15} /></button></div><div className="role-event"><div className="activity-icon activity-approved"><CheckCircle2 size={15} /></div><div><strong>Credential issued</strong><p>Cybersecurity Bootcamp · 2 min ago</p></div><StatusPill status="Approved" /></div><div className="role-event"><div className="activity-icon activity-revoked"><XCircle size={15} /></div><div><strong>Credential revoked</strong><p>Community Steward · 3 days ago</p></div><StatusPill status="Revoked" /></div></section></div><section className="role-security-note"><LockKeyhole size={18} /><div><strong>Issuer signing stays in your wallet.</strong><p>ProofPass prepares the transaction; Midnight wallet confirms and submits it. Private holder attributes never enter the public registry.</p></div><span className={`connector-state ${walletSession ? "connector-live" : ""}`}>{walletSession ? "Wallet ready" : "Connect wallet"}</span><span className={`artifact-status ${artifactIsReady ? "artifact-status-ready" : ""}`}>{artifactIsReady ? "Artifacts ready" : artifactState.label}</span><button className="button button-ghost role-register-button" onClick={onRegisterIssuer}>Register issuer</button></section></div>;
}

function VerifierWorkspace({ walletSession, onConnect, onCreateRequest }: { walletSession: MidnightWalletSession | null; onConnect: () => void; onCreateRequest: () => void }) {
  return <div className="page-content role-page"><SectionHeader eyebrow="Verifier workspace" title="Ask for less. Know enough." description="Build purpose-bound policies and receive only the facts your decision requires." action={<button className="button button-dark" onClick={() => walletSession ? onCreateRequest() : onConnect()}><QrCode size={16} /> Create proof request</button>} /><div className="role-hero role-verifier"><div><div className="hero-kicker"><span className="live-dot" />Verifier controls <span className="hero-separator">/</span> Admissions team <DemoTag /></div><h2>Verification workspace</h2><p>Replace document collection with a precise, auditable proof policy.</p></div><div className="role-hero-stat"><span>86%</span><small>less data requested</small><b><ShieldCheck size={13} /> Privacy-first <DemoTag /></b></div></div><div className="policy-builder"><div className="panel-heading"><div><p className="eyebrow">Policy builder</p><h2>Confirm bootcamp completion <DemoTag /></h2></div><StatusPill status="Active" /></div><p className="policy-purpose">Purpose: assess eligibility for the advanced security cohort.</p><div className="policy-conditions"><div className="policy-condition"><span className="condition-number">01</span><div><strong>Completion status</strong><p>Must equal <b>completed</b></p></div><CheckCircle2 size={18} /></div><div className="policy-connector">AND</div><div className="policy-condition"><span className="condition-number">02</span><div><strong>Credential status</strong><p>Must be <b>active</b> and not expired</p></div><CheckCircle2 size={18} /></div></div><div className="policy-footer"><span><LockKeyhole size={14} /> Holder controls final disclosure</span><button className="button button-primary" onClick={() => toast("Policy saved", { description: "The verifier policy is ready for a new request." })}>Save policy <Check size={15} /></button></div></div><div className="role-security-note"><ShieldCheck size={18} /><div><strong>Verification returns facts, not files.</strong><p>Every presentation includes a nonce, expiry, and issuer status check before it is accepted.</p></div><span className={`connector-state ${walletSession ? "connector-live" : ""}`}>{walletSession ? "Wallet ready" : "Connect wallet"}</span></div></div>;
}

function SearchOverlay({ onClose, onNavigate }: { onClose: () => void; onNavigate: (workspace: Workspace) => void }) {
  const options: Array<{ label: string; detail: string; workspace: Workspace; icon: LucideIcon }> = [{ label: "Overview", detail: "Your privacy snapshot", workspace: "overview", icon: LayoutDashboard }, { label: "Credentials", detail: "View your verifiable facts", workspace: "credentials", icon: BadgeCheck }, { label: "Proof requests", detail: "Review sharing requests", workspace: "requests", icon: FileCheck2 }, { label: "Settings", detail: "Manage privacy defaults", workspace: "settings", icon: Settings2 }];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="search-modal" role="dialog" aria-modal="true" aria-label="Search ProofPass"><div className="search-input-row"><Search size={18} /><input autoFocus placeholder="Search ProofPass" /><kbd>ESC</kbd></div><div className="search-results"><p className="eyebrow">Jump to</p>{options.map((option) => { const Icon = option.icon; return <button key={option.label} className="search-result" onClick={() => { onNavigate(option.workspace); onClose(); }}><span className="search-result-icon"><Icon size={17} /></span><span><strong>{option.label}</strong><small>{option.detail}</small></span><ChevronRight size={15} /></button>; })}</div><div className="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span></div></div></div>;
}

function WalletPickerModal({ wallets, incompatible, foreign, network, onNetworkChange, onClose, onSelect, isConnecting }: { wallets: DetectedWallet[]; incompatible: IncompatibleWallet[]; foreign: ForeignWallet[]; network: MidnightNetwork; onNetworkChange: (network: MidnightNetwork) => void; onClose: () => void; onSelect: (wallet: DetectedWallet) => void; isConnecting: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isConnecting) onClose(); }}><div className="wallet-picker-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title"><div className="modal-header"><div className="wallet-picker-heading"><span className="wallet-picker-icon"><WalletCards size={18} /></span><div><p className="eyebrow">Midnight connection</p><h2 id="wallet-picker-title">Choose a wallet</h2></div></div><button className="icon-button" onClick={onClose} disabled={isConnecting} aria-label="Close wallet picker"><X size={18} /></button></div><p className="wallet-picker-lede">ProofPass will request a connection to {getNetworkLabel(network)}. Your private keys stay inside the selected wallet.</p><div className="network-picker"><div className="network-picker-head"><span className="eyebrow">Network</span><small>Must match the network your wallet is on, or the wallet rejects the request.</small></div><div className="network-options" role="group" aria-label="Midnight network">{MIDNIGHT_NETWORKS.map((option) => <button key={option} type="button" className={`network-chip ${option === network ? "network-chip-active" : ""}`} onClick={() => onNetworkChange(option)} disabled={isConnecting} aria-pressed={option === network}>{option}</button>)}</div></div>{incompatible.length > 0 && <div className="wallet-version-warning"><CircleHelp size={14} />{incompatible.map((entry) => <span key={entry.id}><strong>{entry.name}</strong> exposes connector API v{entry.apiVersion}. ProofPass speaks v{SUPPORTED_API_MAJOR} — update the extension to connect.</span>)}</div>}{wallets.length ? <div className="wallet-options">{wallets.map((wallet) => <button className="wallet-option" key={wallet.id} onClick={() => onSelect(wallet)} disabled={isConnecting}><span className="wallet-option-logo">{wallet.icon ? <img src={wallet.icon} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <WalletCards size={19} />}</span><span className="wallet-option-copy"><strong>{wallet.name}</strong><small>API v{wallet.apiVersion} · {wallet.rdns ?? wallet.id}</small></span><ChevronRight size={16} /></button>)}</div> : <div className="wallet-empty"><WalletCards size={23} /><strong>No Midnight wallet detected</strong><span>ProofPass needs a wallet that implements the Midnight DApp Connector API v{SUPPORTED_API_MAJOR} and injects itself at <code>window.midnight</code>.</span>{foreign.length > 0 && <div className="wallet-foreign"><p>{foreign.length === 1 ? "This browser has 1 other wallet extension, but it serves a different chain and cannot sign Midnight transactions:" : `This browser has ${foreign.length} other wallet extensions, but they serve other chains and cannot sign Midnight transactions:`}</p><ul>{foreign.map((entry) => <li key={`${entry.ecosystem}-${entry.name}`}><strong>{entry.name}</strong><span>{entry.ecosystem}</span></li>)}</ul></div>}<button className="button button-primary" onClick={() => window.open(getWalletInstallUrl(), "_blank", "noopener,noreferrer")}>Install Lace Midnight Preview</button></div>}<div className="wallet-picker-footnote"><LockKeyhole size={13} /> We save provider metadata only; no private key or seed phrase enters ProofPass.</div></div></div>;
}

export default function Home({ workspace, onWorkspaceChange }: { workspace: Workspace; onWorkspaceChange: (workspace: Workspace) => void }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [requests, setRequests] = useState(initialRequests);
  const [activeRequest, setActiveRequest] = useState<ProofRequestView | null>(null);
  const [walletScan, setWalletScan] = useState(() => scanMidnightWallets());
  const [foreignWallets, setForeignWallets] = useState<ForeignWallet[]>([]);
  const [targetNetwork, setTargetNetwork] = useState<MidnightNetwork>(() => getStoredNetwork());
  const wallets = walletScan.compatible;
  const [walletSession, setWalletSession] = useState<MidnightWalletSession | null>(null);
  const { isAuthenticated, user } = useAuth();
  const registryQuery = trpc.issuer.registry.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const contractStatusQuery = trpc.contract.artifactStatus.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const saveWalletConnection = trpc.wallet.saveConnection.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const createIssuerMutation = trpc.issuer.create.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const attachContractMutation = trpc.issuer.attachContract.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const [createRequestOpen, setCreateRequestOpen] = useState(false);
  const createProofRequest = trpc.proofRequests.create.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const approveProofRequest = trpc.proofRequests.approve.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const declineProofRequest = trpc.proofRequests.decline.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const recordVerification = trpc.verification.record.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const resolvingRequest = approveProofRequest.isPending || declineProofRequest.isPending;

  // Persisted requests lead, because those are the ones the operator just made;
  // the seeded set stays behind them so the demo still reads as populated.
  const serverRequests = useMemo(() => ((registryQuery.data?.proofRequests ?? []) as ServerProofRequest[]).map(toDisplayRequest), [registryQuery.data]);
  const allRequests = useMemo(() => preferStored(serverRequests, requests), [serverRequests, requests]);
  // PRD §13.3: the trail has to grow when a request is answered, so real rows
  // lead and the seeded ones stay behind them wearing a Demo label.
  const activity = useMemo<ActivityItem[]>(() => preferStored(
    toActivityItems((registryQuery.data?.proofRequests ?? []) as ServerProofRequest[]),
    activityItems.map((item) => ({ ...item, seeded: true })),
  ), [registryQuery.data]);

  // Eight hardcoded bar heights used to stand in for this, unlabelled.
  // Replaces a "privacy score" and a "data kept private" percentage that were
  // composites of nothing: every figure here comes from a stored row.
  const disclosure = useMemo(
    () => isAuthenticated && registryQuery.data
      ? disclosureSummary(registryQuery.data.proofRequests, registryQuery.data.verifications)
      : undefined,
    [isAuthenticated, registryQuery.data],
  );

  const verificationDays = useMemo(
    () => verificationTrend(registryQuery.data?.verifications ?? [], 8),
    [registryQuery.data],
  );

  useEffect(() => {
    const refreshWallets = () => setWalletScan(scanMidnightWallets());
    refreshWallets();
    window.addEventListener("midnight:wallets-changed", refreshWallets);
    return () => window.removeEventListener("midnight:wallets-changed", refreshWallets);
  }, []);

  const adoptSession = async (session: MidnightWalletSession) => {
    setWalletSession(session);
    setWalletPickerOpen(false);
    if (session.network !== targetNetwork) {
      setTargetNetwork(session.network);
      setStoredNetwork(session.network);
    }
    if (isAuthenticated) {
      await saveWalletConnection.mutateAsync({ providerId: session.wallet.id, providerName: session.wallet.name, walletAddress: session.rawAddress, networkId: session.network });
    }
    toast.success(`${session.wallet.name} connected`, { description: `${session.address} · ${session.network}` });
  };

  /**
   * Asking each remaining network in turn is a separate, deliberate step: the
   * adapter rejects an unexpected network (ARCHITECTURE §18), so the network we
   * end up on is one the user asked us to find.
   */
  /** Keeps the user informed while the wallet's own window is waiting on them. */
  const waitForWallet = <T,>(wallet: DetectedWallet, call: Promise<T>) =>
    awaitWalletResponse(call, {
      walletName: wallet.name,
      onSlow: () => toast(`Waiting for ${wallet.name}`, { description: "Approve the connection in the wallet's window — it may have opened behind this one, or the wallet may be locked." }),
    });

  const reportWalletFailure = (wallet: DetectedWallet, error: unknown) => {
    if (error instanceof WalletUnresponsiveError) {
      toast.error(`${wallet.name} did not respond`, { description: error.message });
      return;
    }
    if (isStaleProviderError(error)) {
      // "Wallet connection cancelled" is misleading here: nobody cancelled
      // anything, the page is talking to an extension context that is gone.
      const stale = new WalletStaleError(wallet.name);
      toast.error(`${wallet.name} needs a page reload`, {
        description: stale.message,
        action: { label: "Reload", onClick: () => window.location.reload() },
        duration: 30_000,
      });
      return;
    }
    toast.error("Wallet connection cancelled", { description: error instanceof Error ? error.message : "The wallet did not approve this connection." });
  };

  const findWalletNetwork = async (wallet: DetectedWallet) => {
    setConnectingWallet(true);
    try {
      await adoptSession(await waitForWallet(wallet, discoverWalletNetwork(wallet, targetNetwork)));
    } catch (error) {
      if (error instanceof WalletUnresponsiveError) reportWalletFailure(wallet, error);
      else toast.error("No network matched", { description: error instanceof Error ? error.message : `${wallet.name} did not accept any Midnight network.` });
    } finally {
      setConnectingWallet(false);
    }
  };

  const connectWallet = async (wallet: DetectedWallet) => {
    setConnectingWallet(true);
    try {
      await adoptSession(await waitForWallet(wallet, connectMidnightWallet(wallet, targetNetwork)));
    } catch (error) {
      if (error instanceof WalletNetworkMismatchError) {
        toast.error("Wrong network selected", {
          description: `${wallet.name} is not on "${targetNetwork}", and it will not say which network it is on. Pick another above, or let ProofPass ask each one.`,
          action: { label: "Find it", onClick: () => { void findWalletNetwork(wallet); } },
        });
      } else {
        reportWalletFailure(wallet, error);
      }
    } finally {
      setConnectingWallet(false);
    }
  };

  const registerIssuer = async () => {
    if (!isAuthenticated) {
      toast("Sign in to save an issuer identity", { description: isLoginConfigured() ? "Issuer registry records are scoped to your authenticated account." : "Issuer registry records need an authenticated account, and sign-in is not configured in this deployment.", action: isLoginConfigured() ? { label: "Sign in", onClick: () => startLogin() } : undefined });
      return;
    }
    try {
      const suffix = Date.now().toString(36).slice(-6);
      await createIssuerMutation.mutateAsync({ slug: `northstar-${suffix}`, displayName: "Northstar Academy", did: "did:midnight:northstar-academy", networkId: targetNetwork });
      toast.success("Issuer registered", { description: "Northstar Academy is now persisted in your issuer registry." });
    } catch (error) {
      toast.error("Issuer registration failed", { description: error instanceof Error ? error.message : "Please try again after signing in." });
    }
  };

  const approveRequest = (id: string) => {
    const request = allRequests.find((item) => item.id === id);
    if (!request) return;
    setActiveRequest(request);
  };

  const resolveApproval = async (selectedAttributes: string[]) => {
    if (!activeRequest) return;
    const request = activeRequest;
    const serverId = serverRequestId(request);
    if (serverId === null) {
      setActiveRequest(null);
      setRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: "Approved", expires: "approved just now" } : item));
      toast.success("Proof approved", { description: `${request.verifier} received only the requested attributes.` });
      return;
    }
    try {
      await approveProofRequest.mutateAsync({ requestId: serverId });
    } catch (error) {
      toast.error("Could not approve the request", { description: error instanceof Error ? error.message : "Please try again." });
      return;
    }
    setActiveRequest(null);
    toast.success("Proof approved", { description: `${request.verifier} received only the requested attributes.` });
    // ARCHITECTURE §10 puts selectedAttributes, a consent version and a nonce on
    // an approval, but proofRequests.approve takes only the id. They are kept as
    // the Presentation that ARCHITECTURE §7 already models, so replay protection
    // and disclosure scope have somewhere durable to live. The approval itself
    // already succeeded, so a failure here is reported without undoing it.
    try {
      await recordVerification.mutateAsync({
        proofRequestId: serverId,
        holderUserId: user?.id,
        verificationKey: crypto.randomUUID(),
        status: "verified",
        resultSummary: JSON.stringify({ consentVersion: CONSENT_VERSION, disclosedAttributes: selectedAttributes }),
      });
    } catch (error) {
      toast.warning("Approved, but the consent record failed", { description: error instanceof Error ? error.message : "The approval stands; the audit entry did not save." });
    }
  };

  const resolveDecline = async (reason: string) => {
    if (!activeRequest) return;
    const request = activeRequest;
    const serverId = serverRequestId(request);
    // PRD §7.2 asks for the reason but there is no column for it, so it is shown
    // back to the holder rather than silently dropped.
    const note = reason ? `Noted: ${reason}` : `${request.verifier} was given nothing.`;
    if (serverId === null) {
      setActiveRequest(null);
      setRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: "Declined", expires: "declined just now" } : item));
      toast("Proof declined", { description: note });
      return;
    }
    try {
      await declineProofRequest.mutateAsync({ requestId: serverId });
      setActiveRequest(null);
      toast("Proof declined", { description: note });
    } catch (error) {
      toast.error("Could not decline the request", { description: error instanceof Error ? error.message : "Please try again." });
    }
  };

  const [deployingContract, setDeployingContract] = useState(false);

  /**
   * Deploys contracts/proofpass.compact through the connected wallet. Every
   * endpoint comes from the wallet, and the authority secret never leaves the
   * browser — only its hash reaches the ledger.
   */
  /**
   * The registry is where a deployed address outlives the browser, but writing
   * to it needs an authenticated account and an issuer on the same network, and
   * neither is guaranteed at deploy time. Every outcome says where the address
   * ended up rather than leaving the operator to guess.
   */
  const recordContractAgainstIssuer = async (result: { contractAddress: string; networkId: string }) => {
    if (!isAuthenticated) {
      toast("Contract address kept in this browser only", { description: "Sign in and register an issuer to record it in the registry." });
      return;
    }
    const issuer = issuerForContract(registryQuery.data?.issuers ?? [], result.networkId);
    if (!issuer) {
      toast("No issuer to attach the contract to", { description: `Register an issuer on ${result.networkId}, then attach ${result.contractAddress}.` });
      return;
    }
    try {
      await attachContractMutation.mutateAsync({ issuerId: issuer.id, contractAddress: result.contractAddress });
      toast.success("Contract recorded in the registry", { description: `${issuer.displayName} now points at ${result.contractAddress}.` });
    } catch (error) {
      toast.error("Could not record the contract", { description: readableMessage(error) });
    }
  };

  const deployContract = async () => {
    if (!walletSession) { openWalletPicker(); return; }
    setDeployingContract(true);
    try {
      const result = await deployProofPass(walletSession.connected as never);
      // Before anything else can fail: at this instant it is the only copy.
      rememberDeployedContract(result);
      toast.success("Contract deployed", { description: `${result.contractAddress} on ${result.networkId}` });
      if (result.authority.source === "generated") {
        // Losing this means the registry can never be administered again.
        toast("Back up the registry authority", { description: `Authority seed: ${result.authority.hex}`, duration: 60_000 });
      }
      console.info("[ProofPass] deployed", result);
      await recordContractAgainstIssuer(result);
    } catch (error) {
      const described = describeError(error);
      toast.error("Deployment failed", { description: readableMessage(error) });
      console.error("[ProofPass] deploy failed", error, described);
      // A failed deploy is the one moment the operator most needs the detail,
      // and a toast is gone in seconds. Keep the last one where it survives a
      // reload, so it can be read back instead of reproduced.
      try {
        localStorage.setItem("proofpass:last-deploy-error", JSON.stringify(described));
      } catch { /* storage unavailable; the console still has it */ }
    } finally {
      setDeployingContract(false);
    }
  };

  const openCreateRequest = () => {
    if (!isAuthenticated) {
      toast("Sign in to create a proof request", { description: isLoginConfigured() ? "Proof requests are stored against your authenticated account." : "Proof requests are stored against an authenticated account, and sign-in is not configured in this deployment.", action: isLoginConfigured() ? { label: "Sign in", onClick: () => startLogin() } : undefined });
      return;
    }
    setCreateRequestOpen(true);
  };

  const submitCreateRequest = async (input: NewRequestInput) => {
    try {
      await createProofRequest.mutateAsync({
        requestKey: `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        verifierName: input.verifierName,
        purpose: input.purpose,
        requestedAttributes: input.requestedAttributes,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86400000),
        // Addressed to the signed-in account: the holder is who approves, and
        // approve/decline only match rows whose holderUserId is the caller.
        holderUserId: user?.id,
      });
      setCreateRequestOpen(false);
      toast.success("Proof request created", { description: `${input.verifierName} · ${input.requestedAttributes.length} attribute${input.requestedAttributes.length === 1 ? "" : "s"} requested.` });
    } catch (error) {
      toast.error("Could not create the request", { description: error instanceof Error ? error.message : "Please try again." });
    }
  };

  const openWalletPicker = () => {
    const scan = scanMidnightWallets();
    setWalletScan(scan);
    setWalletPickerOpen(true);
    // Only worth naming the other extensions when there is nothing to connect to.
    if (!scan.compatible.length) void detectForeignWallets().then(setForeignWallets);
  };

  const persistedCredentials = registryQuery.data?.credentials ?? [];
  const persistedCredentialCount = isAuthenticated && registryQuery.data ? persistedCredentials.length : undefined;
  const persistedActiveCredentialCount = isAuthenticated && registryQuery.data ? persistedCredentials.filter((credential) => credential.status === "active" || credential.status === "expiring").length : undefined;
  const persistedRevokedCount = isAuthenticated && registryQuery.data ? persistedCredentials.filter((credential) => credential.status === "revoked").length : undefined;
  const persistedExpiringCount = isAuthenticated && registryQuery.data ? persistedCredentials.filter((credential) => credential.status === "expiring").length : undefined;
  const persistedVerificationCount = isAuthenticated && registryQuery.data ? registryQuery.data.verifications.length : undefined;

  // The panel derives the on-chain issuer id from a slug; these are the rows
  // that slug can name, so a credential lands against a real registry issuer.
  // Stored credentials lead and the seeded set stays behind them wearing a Demo
  // label, the same order the proof-request list uses.
  const allCredentials = useMemo(() => {
    const issuerName = new Map((registryQuery.data?.issuers ?? []).map((issuer) => [issuer.id, issuer.displayName]));
    const stored = (registryQuery.data?.credentials ?? []).map((row) => toDisplayCredential(row, issuerName.get(row.issuerId)));
    // The same rule the request list uses: seeded cards only when nothing is stored.
    return preferStored(stored, seededCredentials);
  }, [registryQuery.data]);

  const registryIssuers = useMemo(
    () => (registryQuery.data?.issuers ?? []).map((issuer) => ({ id: issuer.id, slug: issuer.slug, displayName: issuer.displayName })),
    [registryQuery.data],
  );
  const issueCredential = trpc.credential.issue.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const revokeCredential = trpc.credential.revoke.useMutation({ onSuccess: () => { void registryQuery.refetch(); } });
  const registerIssuerWithSlug = usePersistFn(async (slug: string, network: MidnightNetwork) => {
    await createIssuerMutation.mutateAsync({ slug, displayName: issuerDisplayName(slug), networkId: network });
  });
  const issueCredentialRecord = usePersistFn(async (credential: IssuedCredential) => { await issueCredential.mutateAsync(credential); });
  const revokeCredentialRecord = usePersistFn(async (credentialKey: string) => { await revokeCredential.mutateAsync({ credentialKey }); });

  // The hero used to print an invented block height. Every endpoint comes from
  // the wallet, so with none connected there is no indexer to ask and the block
  // line is simply absent.
  const [chainHeight, setChainHeight] = useState<number | undefined>(undefined);
  const indexerUri = walletSession?.configuration?.indexerUri;
  useEffect(() => {
    if (!indexerUri) { setChainHeight(undefined); return; }
    let current = true;
    void fetchChainTip(indexerUri).then((tip) => { if (current) setChainHeight(tip?.height); });
    return () => { current = false; };
  }, [indexerUri]);
  // Badges only appear for counts that came from the store; the seeded rows are
  // labelled in the list itself and must not inflate a number in the sidebar.
  const navCounts: Partial<Record<Workspace, number>> = {
    credentials: persistedCredentialCount || undefined,
    requests: serverRequests.length || undefined,
  };


  return <div className="app-shell"><div className={`sidebar-wrap ${mobileOpen ? "sidebar-wrap-open" : ""}`}><Sidebar workspace={workspace} onWorkspaceChange={onWorkspaceChange} onClose={() => setMobileOpen(false)} accountName={user ? (user.name?.trim() || user.openId) : null} counts={navCounts} /></div><div className="app-main"><Topbar workspace={workspace} onOpenMenu={() => setMobileOpen(true)} onSearch={() => setSearchOpen(true)} walletSession={walletSession} walletCount={wallets.length} onConnect={openWalletPicker} /><div className="mobile-page-title"><span>{pageTitle[workspace]}</span><div className="mobile-status"><span className="network-pulse" /> {walletSession ? "Connected" : "Demo"}</div></div>{workspace === "overview" && <Overview onWorkspaceChange={onWorkspaceChange} onApprove={approveRequest} requests={allRequests} activity={activity} walletSession={walletSession} metrics={{ credentials: persistedCredentialCount, activeCredentials: persistedActiveCredentialCount, proofsShared: persistedVerificationCount }} chainHeight={chainHeight} disclosure={disclosure} />}{workspace === "credentials" && <Credentials credentials={allCredentials} onIssue={() => onWorkspaceChange("onchain")} />}{workspace === "requests" && <ProofRequests onApprove={approveRequest} requests={allRequests} onCreate={openCreateRequest} />}{workspace === "activity" && <ActivityPage activity={activity} proofsShared={persistedVerificationCount} trend={verificationDays} />}{workspace === "issuer" && <IssuerWorkspace walletSession={walletSession} onConnect={openWalletPicker} onRegisterIssuer={registerIssuer} onDeployContract={deployContract} deploying={deployingContract} credentialCount={persistedCredentialCount} activeCredentialCount={persistedActiveCredentialCount} revokedCount={persistedRevokedCount} expiringCount={persistedExpiringCount} artifactReady={Boolean(contractStatusQuery.data?.configured && contractStatusQuery.data.moduleAvailable && contractStatusQuery.data.assetsAvailable)} />}{workspace === "verifier" && <VerifierWorkspace walletSession={walletSession} onConnect={openWalletPicker} onCreateRequest={openCreateRequest} />}{workspace === "onchain" && <OnChainWorkflow walletSession={walletSession} onConnect={openWalletPicker} issuers={registryIssuers} onCredentialIssued={issueCredentialRecord} onCredentialRevoked={revokeCredentialRecord} onRegisterIssuer={registerIssuerWithSlug} canRegisterIssuer={isAuthenticated} />}{workspace === "settings" && <Settings walletSession={walletSession} onConnect={openWalletPicker} network={targetNetwork} onNetworkChange={(next) => { setTargetNetwork(next); setStoredNetwork(next); }} />}</div>{activeRequest && <ApprovalModal request={activeRequest} onClose={() => setActiveRequest(null)} onApprove={resolveApproval} onDecline={resolveDecline} isBusy={resolvingRequest} />}{searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onNavigate={onWorkspaceChange} />}{walletPickerOpen && <WalletPickerModal wallets={wallets} incompatible={walletScan.incompatible} foreign={foreignWallets} network={targetNetwork} onNetworkChange={(next) => { setTargetNetwork(next); setStoredNetwork(next); }} onClose={() => setWalletPickerOpen(false)} onSelect={connectWallet} isConnecting={connectingWallet} />}{createRequestOpen && <CreateRequestModal onClose={() => setCreateRequestOpen(false)} onSubmit={submitCreateRequest} isSaving={createProofRequest.isPending} />}</div>;
}
